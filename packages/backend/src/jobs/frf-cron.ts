import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { query } from '../db/index.js';
import { get_unprocessed_contacts, get_contact_batches, format_batch_prompt } from '../services/ai/batching.js';
import { extract_from_batch } from '../services/ai/extraction.js';
import { create_extracted_fact_v2, type ExtractedFactInput } from '../services/facts.js';
import { create_extracted_relationship, type ExtractedRelationshipInput } from '../services/relationships.js';
import { create_content_detected_followup } from '../services/followups.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PipelineResult {
  skipped?: boolean;
  contacts_processed: number;
  batches_processed: number;
  facts_created: number;
  facts_deduplicated: number;
  facts_superseded: number;
  relationships_created: number;
  followups_created: number;
  followups_skipped_cutoff: number;
  errors: number;
  duration_ms: number;
}

function empty_result(): PipelineResult {
  return {
    contacts_processed: 0,
    batches_processed: 0,
    facts_created: 0,
    facts_deduplicated: 0,
    facts_superseded: 0,
    relationships_created: 0,
    followups_created: 0,
    followups_skipped_cutoff: 0,
    errors: 0,
    duration_ms: 0,
  };
}

// ── Mutex ──────────────────────────────────────────────────────────────────

let is_running = false;

export function is_pipeline_running(): boolean {
  return is_running;
}

// ── Rate limit detection ───────────────────────────────────────────────────

function is_rate_limit_error(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED');
  }
  return false;
}

// ── Delay helper ───────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Pipeline ───────────────────────────────────────────────────────────────

export async function run_frf_pipeline(): Promise<PipelineResult> {
  if (is_running) {
    logger.info('FRF pipeline already running, skipping');
    return { ...empty_result(), skipped: true };
  }

  is_running = true;
  const start = Date.now();
  const result = empty_result();

  try {
    const contacts = await get_unprocessed_contacts();

    if (contacts.length === 0) {
      logger.debug('FRF pipeline: no unprocessed communications');
      return result;
    }

    logger.info('FRF pipeline started', {
      contacts: contacts.length,
      total_unprocessed: contacts.reduce((sum, c) => sum + c.unprocessed_count, 0),
    });

    for (const contact of contacts) {
      try {
        const batches = await get_contact_batches(
          contact.contact_id,
          config.frf_batch_size,
          config.frf_batch_overlap,
          config.frf_context_messages,
        );

        for (const batch of batches) {
          try {
            const formatted = format_batch_prompt(
              batch.context_messages,
              batch.batch_messages,
              batch.contact_name,
            );

            const extraction = await extract_from_batch(formatted, batch.contact_name);

            // Process facts
            for (const fact of extraction.facts) {
              try {
                const input: ExtractedFactInput = {
                  contact_id: batch.contact_id,
                  fact_type: fact.fact_type,
                  value: fact.value,
                  structured_value: fact.structured_value ?? undefined,
                  confidence: fact.confidence,
                };

                const fact_result = await create_extracted_fact_v2(
                  batch.communication_ids[0],
                  input,
                  { dedup_similarity: config.frf_dedup_similarity },
                );

                if (fact_result.action === 'inserted') result.facts_created++;
                else if (fact_result.action === 'skipped_duplicate') result.facts_deduplicated++;
                else if (fact_result.action === 'superseded') result.facts_superseded++;
              } catch (error) {
                logger.error('Failed to create fact', {
                  error: error instanceof Error ? error.message : 'Unknown error',
                  contact_id: batch.contact_id,
                  fact_type: fact.fact_type,
                });
                result.errors++;
              }
            }

            // Process relationships
            for (const rel of extraction.relationships) {
              try {
                const input: ExtractedRelationshipInput = {
                  contact_id: batch.contact_id,
                  label: rel.label,
                  person_name: rel.person_name,
                  confidence: rel.confidence,
                };

                const created = await create_extracted_relationship(
                  batch.communication_ids[0],
                  input,
                );

                if (created) result.relationships_created++;
              } catch (error) {
                logger.error('Failed to create relationship', {
                  error: error instanceof Error ? error.message : 'Unknown error',
                  contact_id: batch.contact_id,
                  label: rel.label,
                });
                result.errors++;
              }
            }

            // Process followups
            for (const followup of extraction.followups) {
              try {
                // Use the earliest message timestamp in the batch for cutoff check
                const batch_timestamp = batch.batch_messages[0]?.timestamp;

                const created = await create_content_detected_followup(
                  batch.contact_id,
                  batch.communication_ids[0],
                  followup.reason,
                  followup.suggested_date,
                  batch_timestamp ? new Date(batch_timestamp) : undefined,
                );

                if (created) result.followups_created++;
                else result.followups_skipped_cutoff++;
              } catch (error) {
                logger.error('Failed to create followup', {
                  error: error instanceof Error ? error.message : 'Unknown error',
                  contact_id: batch.contact_id,
                  reason: followup.reason,
                });
                result.errors++;
              }
            }

            // Mark batch communications as processed
            await query(
              `UPDATE communications SET frf_processed_at = NOW() WHERE id = ANY($1::uuid[])`,
              [batch.communication_ids],
            );

            result.batches_processed++;

            // Delay between batches to avoid rate limits
            if (config.frf_batch_delay_ms > 0) {
              await delay(config.frf_batch_delay_ms);
            }
          } catch (error) {
            // Rate limit: stop entire run
            if (is_rate_limit_error(error)) {
              logger.warn('FRF pipeline rate limited, stopping run', {
                contact_id: contact.contact_id,
              });
              result.errors++;
              return result;
            }

            // Other API error: retry once
            try {
              logger.warn('Batch failed, retrying once', {
                contact_id: contact.contact_id,
                error: error instanceof Error ? error.message : 'Unknown error',
              });

              const formatted = format_batch_prompt(
                batch.context_messages,
                batch.batch_messages,
                batch.contact_name,
              );

              const extraction = await extract_from_batch(formatted, batch.contact_name);

              // Simplified retry: just persist what we get
              for (const fact of extraction.facts) {
                try {
                  await create_extracted_fact_v2(
                    batch.communication_ids[0],
                    {
                      contact_id: batch.contact_id,
                      fact_type: fact.fact_type,
                      value: fact.value,
                      structured_value: fact.structured_value ?? undefined,
                      confidence: fact.confidence,
                    },
                    { dedup_similarity: config.frf_dedup_similarity },
                  );
                  result.facts_created++;
                } catch {
                  result.errors++;
                }
              }

              for (const rel of extraction.relationships) {
                try {
                  const created = await create_extracted_relationship(
                    batch.communication_ids[0],
                    {
                      contact_id: batch.contact_id,
                      label: rel.label,
                      person_name: rel.person_name,
                      confidence: rel.confidence,
                    },
                  );
                  if (created) result.relationships_created++;
                } catch {
                  result.errors++;
                }
              }

              for (const followup of extraction.followups) {
                try {
                  const created = await create_content_detected_followup(
                    batch.contact_id,
                    batch.communication_ids[0],
                    followup.reason,
                    followup.suggested_date,
                  );
                  if (created) result.followups_created++;
                } catch {
                  result.errors++;
                }
              }

              await query(
                `UPDATE communications SET frf_processed_at = NOW() WHERE id = ANY($1::uuid[])`,
                [batch.communication_ids],
              );

              result.batches_processed++;
            } catch (retryError) {
              // Retry also failed — check for rate limit again
              if (is_rate_limit_error(retryError)) {
                logger.warn('FRF pipeline rate limited on retry, stopping run');
                result.errors++;
                return result;
              }

              logger.error('Batch retry failed, skipping', {
                contact_id: contact.contact_id,
                error: retryError instanceof Error ? retryError.message : 'Unknown error',
              });
              result.errors++;
            }
          }
        }

        result.contacts_processed++;
      } catch (error) {
        // Database error at contact level: skip contact, continue
        logger.error('Failed to process contact, skipping', {
          contact_id: contact.contact_id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.errors++;
      }
    }

    return result;
  } catch (error) {
    logger.error('FRF pipeline failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    result.errors++;
    return result;
  } finally {
    result.duration_ms = Date.now() - start;
    is_running = false;

    logger.info('FRF pipeline completed', {
      contacts_processed: result.contacts_processed,
      batches_processed: result.batches_processed,
      facts_created: result.facts_created,
      facts_deduplicated: result.facts_deduplicated,
      facts_superseded: result.facts_superseded,
      relationships_created: result.relationships_created,
      followups_created: result.followups_created,
      followups_skipped_cutoff: result.followups_skipped_cutoff,
      errors: result.errors,
      duration_ms: result.duration_ms,
    });
  }
}

// ── Cron scheduling ────────────────────────────────────────────────────────

let cron_task: cron.ScheduledTask | null = null;

export function start_frf_cron(): void {
  if (cron_task) {
    logger.warn('FRF cron already started');
    return;
  }

  const interval = config.frf_cron_interval;

  if (!cron.validate(interval)) {
    logger.error('Invalid FRF cron interval', { interval });
    return;
  }

  cron_task = cron.schedule(interval, () => {
    run_frf_pipeline().catch((error) => {
      logger.error('FRF cron run failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  });

  logger.info('FRF cron started', { interval });
}

export function stop_frf_cron(): void {
  if (cron_task) {
    cron_task.stop();
    cron_task = null;
    logger.info('FRF cron stopped');
  }
}

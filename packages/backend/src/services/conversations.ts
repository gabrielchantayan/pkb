import type pg from 'pg';

export async function update_conversation(
  client: pg.PoolClient,
  source: string,
  thread_id: string,
  contact_id: string,
  communication_id: string
): Promise<string> {
  // Upsert conversation
  const result = await client.query<{ id: string }>(
    `INSERT INTO conversations (source, source_thread_id, participants, first_message_at, last_message_at, message_count)
     SELECT $1, $2, ARRAY[$3]::uuid[], c.timestamp, c.timestamp, 1
     FROM communications c WHERE c.id = $4
     ON CONFLICT (source, source_thread_id) DO UPDATE SET
       participants = array_cat_unique(conversations.participants, ARRAY[$3]::uuid[]),
       last_message_at = GREATEST(conversations.last_message_at, EXCLUDED.last_message_at),
       first_message_at = LEAST(conversations.first_message_at, EXCLUDED.first_message_at),
       message_count = conversations.message_count + 1
     RETURNING id`,
    [source, thread_id, contact_id, communication_id]
  );

  const conversation_id = result.rows[0].id;

  // Link communication to conversation
  await client.query('UPDATE communications SET conversation_id = $1 WHERE id = $2', [
    conversation_id,
    communication_id,
  ]);

  return conversation_id;
}

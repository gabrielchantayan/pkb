import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";

let gen_ai: GoogleGenerativeAI | null = null;
let flash_model: GenerativeModel | null = null;
let pro_model: GenerativeModel | null = null;

function get_gen_ai(): GoogleGenerativeAI {
  if (!config.gemini_api_key) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  if (!gen_ai) {
    gen_ai = new GoogleGenerativeAI(config.gemini_api_key);
  }

  return gen_ai;
}

function get_flash_model(): GenerativeModel {
  if (!flash_model) {
    flash_model = get_gen_ai().getGenerativeModel({
      model: process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash",
    });
  }
  return flash_model;
}

function get_pro_model(): GenerativeModel {
  if (!pro_model) {
    pro_model = get_gen_ai().getGenerativeModel({
      model: process.env.GEMINI_PRO_MODEL || "gemini-2.5-pro",
    });
  }
  return pro_model;
}

export async function generate_with_flash(prompt: string): Promise<string> {
  const model = get_flash_model();
  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function generate_with_pro(prompt: string): Promise<string> {
  const model = get_pro_model();
  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function generate_with_flash_json<T>(
  prompt: string,
  response_schema: object,
): Promise<T> {
  const model = get_gen_ai().getGenerativeModel({
    model: process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema:
        response_schema as import("@google/generative-ai").ResponseSchema,
    },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text) as T;
}

export async function generate_embedding(
  text: string,
): Promise<number[] | null> {
  try {
    const embedding_model = get_gen_ai().getGenerativeModel({
      model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    });
    const result = await embedding_model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    logger.error("Embedding generation failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

export async function generate_embeddings(
  texts: string[],
): Promise<(number[] | null)[]> {
  // Batch embedding - process in chunks to avoid rate limits
  const BATCH_SIZE = 10;
  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batch_results = await Promise.all(
      batch.map((t) => generate_embedding(t)),
    );
    results.push(...batch_results);

    // Rate limiting delay
    if (i + BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}

export function is_ai_available(): boolean {
  if (process.env.AI_ENABLED === "false") {
    return false;
  }
  return config.gemini_api_key !== null;
}

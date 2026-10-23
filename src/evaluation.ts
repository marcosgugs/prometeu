/// IPC types of the application-owned evaluation port (ADR 0058). Only the Settings key test uses it
/// today; the TypeSafe adapter and the API key stay in the Rust backend. This module performs no I/O.

export type EvaluationQuestion = { id: string; prompt: string; outcomes: string[] };
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type EvaluationRequest = { context: string | { [key: string]: JsonValue }; questions: EvaluationQuestion[] };
export type EvaluationAnswer = { id: string; outcome: string; confidence: number };
export type EvaluationResult = { answers: EvaluationAnswer[]; model?: string | null };

/// Only configuration and availability cross IPC; `problem` is an i18n-coded configuration error.
export type EvaluationStatus = { configured: boolean; enabled: boolean; problem: string | null };

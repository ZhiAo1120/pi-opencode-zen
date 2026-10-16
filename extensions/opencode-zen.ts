/**
 * OpenCode Zen free tier, from Pi, without a proxy.
 *
 * The free tier only answers requests shaped like the official OpenCode client:
 * `stream: true`, a `bash` and a `read` function in `tools`, an `opencode/<ver>`
 * User-Agent, and a matching `x-opencode-session` / `x-opencode-session-id` pair.
 * Anything else comes back as `403 FreeTierError`.
 *
 * A normal Pi turn already carries tools named `bash` and `read`, but summarization
 * / compaction builds a tool-less request, which is exactly the shape the server
 * refuses. This extension fills the shape back in for any request missing it and
 * delegates everything else to the built-in openai-completions implementation.
 */
import {
	openAICompletionsApi,
	type Api,
	type AssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
/** Must look like an official client; the free tier rejects unknown agents. */
const OPENCODE_UA = "opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14";

const HEX = "0123456789abcdef";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const pick = (chars: string): string => chars[Math.floor(Math.random() * chars.length)] as string;
const repeat = (n: number, chars: string): string =>
	Array.from({ length: n }, () => pick(chars)).join("");

/**
 * A session id the free tier accepts: `ses_` + 12 lowercase hex + 14 base62.
 * The last three hex digits must land in 0xFC0..0xFFF (a decrementing-timestamp
 * layout); UUIDs, rising counters and shared constants are all rejected with 403.
 */
export const newZenSessionId = (): string =>
	`ses_${repeat(9, HEX)}f${pick("cdef")}${pick(HEX)}${repeat(14, BASE62)}`;

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
/** One id per process. Set OPENCODE_ZEN_SESSION to pin an id known to work. */
const SESSION = env?.OPENCODE_ZEN_SESSION || newZenSessionId();

/**
 * The two function definitions the shape gate looks for, by exact name. They are
 * placeholders: Pi only ever sends this request without tools (compaction), so
 * nothing is expected to call them.
 */
const GATE_TOOLS = [
	{
		type: "function",
		function: {
			name: "bash",
			description: "Placeholder required by the OpenCode free-tier request shape.",
			parameters: {
				type: "object",
				properties: { command: { type: "string" } },
				required: ["command"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "read",
			description: "Placeholder required by the OpenCode free-tier request shape.",
			parameters: {
				type: "object",
				properties: { filePath: { type: "string" } },
				required: ["filePath"],
			},
		},
	},
];

/** Fills in the request shape the free tier demands. Complete requests pass through. */
export function shapeZenPayload(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") return payload;
	const p = { ...(payload as Record<string, unknown>) };
	p.stream = true;
	const tools = Array.isArray(p.tools) ? [...p.tools] : [];
	const names = new Set(
		tools.map((t) => (t as { function?: { name?: string } })?.function?.name).filter(Boolean),
	);
	let injected = false;
	for (const gate of GATE_TOOLS) {
		if (!names.has(gate.function.name)) {
			tools.push(gate);
			injected = true;
		}
	}
	p.tools = tools;
	if (injected && p.tool_choice === undefined) p.tool_choice = "auto";
	return p;
}

function streamZen(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const upstream = { ...model, api: "openai-completions" as const, baseUrl: ZEN_BASE_URL };
	const { onPayload, ...rest } = options ?? {};
	return openAICompletionsApi().streamSimple(upstream as Model<"openai-completions">, context, {
		...rest,
		apiKey: "public",
		headers: {
			...(rest.headers ?? {}),
			"User-Agent": OPENCODE_UA,
			"x-opencode-session": SESSION,
			"x-opencode-session-id": SESSION,
		},
		// Keep any caller hook working: ours only ever adds to its payload.
		onPayload: async (payload, hookModel) =>
			shapeZenPayload((await onPayload?.(payload, hookModel)) ?? payload),
	});
}

export default function (pi: { registerProvider: (name: string, config: unknown) => void }): void {
	pi.registerProvider("opencode-zen", {
		baseUrl: ZEN_BASE_URL,
		apiKey: "public",
		api: "opencode-zen-api",
		streamSimple: streamZen,
	});
}

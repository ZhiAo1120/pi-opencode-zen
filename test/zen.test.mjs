// Unit tests for the extension's pure logic. The pi-ai import is stubbed so the
// test runs without a Pi installation; run with `npm test`.
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

registerHooks({
	resolve(spec, ctx, next) {
		if (spec === "@earendil-works/pi-ai/compat") return { url: "pi-ai-stub:", shortCircuit: true };
		return next(spec, ctx);
	},
	load(url, ctx, next) {
		if (url === "pi-ai-stub:") {
			return {
				format: "module",
				shortCircuit: true,
				source: `export const openAICompletionsApi = () => ({
					streamSimple: (model, context, options) => (globalThis.__zenCall = { model, context, options }),
				});`,
			};
		}
		return next(url, ctx);
	},
});

const { default: register, newZenSessionId, shapeZenPayload } = await import(
	"../extensions/opencode-zen.ts"
);

const SESSION_SHAPE = /^ses_[0-9a-f]{9}f[c-f][0-9a-f][0-9A-Za-z]{14}$/;
const toolNames = (payload) => payload.tools.map((t) => t.function.name);

test("session id matches the shape the free tier accepts", () => {
	for (let i = 0; i < 1000; i++) assert.match(newZenSessionId(), SESSION_SHAPE);
	assert.notEqual(newZenSessionId(), newZenSessionId());
});

test("a tool-less payload gets both gate tools and stream: true", () => {
	const out = shapeZenPayload({ model: "cat-jam-free", messages: [] });
	assert.equal(out.stream, true);
	assert.deepEqual(toolNames(out), ["bash", "read"]);
	assert.equal(out.tool_choice, "auto");
});

test("only the missing gate tool is added", () => {
	const out = shapeZenPayload({ tools: [{ type: "function", function: { name: "bash" } }] });
	assert.deepEqual(toolNames(out), ["bash", "read"]);
});

test("a complete payload keeps its tools and tool_choice", () => {
	const tools = [
		{ type: "function", function: { name: "read" } },
		{ type: "function", function: { name: "bash" } },
	];
	const out = shapeZenPayload({ stream: false, tools, tool_choice: "none" });
	assert.deepEqual(out.tools, tools);
	assert.equal(out.tool_choice, "none");
	assert.equal(out.stream, true, "stream must be forced on regardless");
});

test("non-object payloads pass through untouched", () => {
	assert.equal(shapeZenPayload(null), null);
	assert.equal(shapeZenPayload("x"), "x");
});

test("streamSimple sends the required headers and keeps the caller's onPayload", async () => {
	let config;
	register({ registerProvider: (name, cfg) => (config = { name, ...cfg }) });
	assert.equal(config.name, "opencode-zen");
	assert.equal(config.api, "opencode-zen-api");

	const caller = (payload) => ({ ...payload, fromCaller: true });
	config.streamSimple({ id: "cat-jam-free", api: "opencode-zen-api" }, { messages: [] }, { onPayload: caller });

	const { options } = globalThis.__zenCall;
	const headers = options.headers;
	assert.match(headers["User-Agent"], /^opencode\//);
	assert.match(headers["x-opencode-session"], SESSION_SHAPE);
	assert.equal(headers["x-opencode-session"], headers["x-opencode-session-id"]);
	assert.equal("x-opencode-request" in headers, false, "legacy header must never be sent");

	const shaped = await options.onPayload({ messages: [] });
	assert.equal(shaped.fromCaller, true, "caller hook result must survive");
	assert.deepEqual(toolNames(shaped), ["bash", "read"]);
});

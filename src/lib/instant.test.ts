import { describe, expect, test } from "bun:test";
import { planInstantTeammate } from "./instant";

const catalog = { runtimes: ["claude", "codex", "opencode"], models: { claude: ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"], codex: ["openai/gpt-5"] } };

describe("instant add", () => {
  test("a name not in use, the default brain, a system prompt that names them", () => {
    const plan = planInstantTeammate(catalog, { anthropic_api_key: true }, ["Scout"], () => 0)!;
    expect(plan.name).not.toBe("Scout");
    expect(plan.brain.model).toBe("anthropic/claude-sonnet-5");
    expect(plan.brain.runtime).toBe("claude");
    expect(plan.system).toContain(`You are ${plan.name}`);
  });
  test("falls to a provider with a key", () => {
    expect(planInstantTeammate(catalog, { openai_api_key: true }, [])!.brain.model).toBe("openai/gpt-5");
  });
  test("no models → null", () => {
    expect(planInstantTeammate({ runtimes: [], models: {} }, {}, [])).toBeNull();
  });
});

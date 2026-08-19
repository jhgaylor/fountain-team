import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { FountainClient } from "../api/client";
import type { Teammate } from "../api/types";
import { ContactDialog } from "./ContactDialog";
import { ContactLine } from "./ContactLine";

// Render smoke: the dialog says what it buys and what it costs before
// Confirm; the line shows both numbers, formatted, and whose texts arrive.

const client = {} as unknown as FountainClient;
const teammate = {
  agent_id: "a1",
  name: "Koda",
  contact: null,
} as unknown as Teammate;

describe("ContactDialog", () => {
  test("names the teammate, asks for your number, and says it is billed", () => {
    const html = renderToString(<ContactDialog client={client} teammate={teammate} onClose={() => undefined} onProvisioned={() => undefined} toast={() => undefined} />);
    expect(html).toContain('aria-label="Give Koda an email and phone"');
    expect(html).toContain("Your phone number");
    expect(html).toContain('type="tel"');
    expect(html).toContain("required");
    expect(html).toContain("both are billed");
    expect(html).toContain("Texts from any other number are ignored");
    expect(html).toMatch(/Texts from it to (<!-- -->)?Koda/);
    expect(html).toContain("sms_send");
    // nothing typed yet: Confirm is disabled
    expect(html).toMatch(/<button type="submit" disabled="">Confirm/);
  });
});

describe("ContactLine", () => {
  test("shows the email and the formatted numbers with Copy", () => {
    const html = renderToString(<ContactLine contact={{ email: "koda@agentmail.to", phone: "+15551234567", prompt_from_number: "+15557654321", inserted_at: "2026-08-19T00:00:00Z" }} />);
    expect(html).toContain("koda@agentmail.to");
    expect(html).toContain("+1 (555) 123-4567");
    expect(html).toContain("Texts from <span class=\"mono\">+1 (555) 765-4321</span> arrive here as prompts");
    expect(html.match(/>Copy</g)?.length).toBe(2);
  });
  test("leaves out a channel that is null", () => {
    const html = renderToString(<ContactLine contact={{ email: "koda@agentmail.to", phone: null, prompt_from_number: null, inserted_at: "" }} />);
    expect(html).toContain("koda@agentmail.to");
    expect(html).not.toContain("arrive here as prompts");
    expect(html.match(/>Copy</g)?.length).toBe(1);
  });
});

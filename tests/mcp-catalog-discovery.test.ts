import { expect, it } from "vitest";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import catalog from "../src/automation/catalog.json";

it("advertises every shared tool through the standard MCP discovery schema", () => {
  const result = ListToolsResultSchema.safeParse({
    tools: catalog.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  });
  expect(
    result.success,
    result.success ? undefined : JSON.stringify(result.error.issues),
  ).toBe(true);
});

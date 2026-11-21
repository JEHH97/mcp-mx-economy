// Smoke test for the published binary: starts dist/index.js over stdio with the
// official MCP client, lists tools, and repeats the check through a symlink to
// mirror how npm/npx exposes the bin. No tokens or network access are required
// because the listing does not call any provider.
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = new URL("../", import.meta.url);
const entry = fileURLToPath(new URL("dist/index.js", root));
const expectedTools = [
  "mx_fix_rate",
  "mx_target_rate",
  "mx_inflation",
  "mx_udis",
  "mx_tiie_28d",
  "mx_banxico_series",
  "mx_inegi_indicator",
  "mx_compare_indicators",
];

async function listToolsVia(command) {
  const client = new Client({ name: "smoke-stdio", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [command],
    stderr: "ignore",
    env: { PATH: process.env.PATH ?? "" },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

function assertTools(names, label) {
  const sorted = [...names].sort();
  const expected = [...expectedTools].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    throw new Error(`${label}: unexpected tools ${JSON.stringify(sorted)}`);
  }
}

const direct = await listToolsVia(entry);
assertTools(direct, "direct");

const tempDir = await mkdtemp(join(tmpdir(), "opencode-smoke-"));
try {
  const link = join(tempDir, "mcp-mx-economy");
  await symlink(entry, link);
  const viaSymlink = await listToolsVia(link);
  assertTools(viaSymlink, "symlink");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log(
  `stdio smoke passed: ${direct.length} tools, direct and via bin symlink.`,
);

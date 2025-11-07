import { simulate } from "./simulate.js";

/**
 * Example: Using simulate() programmatically
 */
async function main() {
  console.log("Running programmatic simulation example...\n");

  // Example 1: Ask a question about a library
  await simulate("Show me authentication examples from Supabase");

  // Example 2: Ask another question
  // await simulate("How do I use React hooks?");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

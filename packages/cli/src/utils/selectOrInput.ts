import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  isEnterKey,
  isUpKey,
  isDownKey,
} from "@inquirer/core";
import type { KeypressEvent } from "@inquirer/core";
import pc from "picocolors";

export interface SelectOrInputConfig {
  message: string;
  options: string[];
  recommendedIndex?: number;
}

const selectOrInput: (config: SelectOrInputConfig) => Promise<string> = createPrompt<
  string,
  SelectOrInputConfig
>((config, done): string => {
  const { message, options, recommendedIndex = 0 } = config;
  const [cursor, setCursor] = useState(recommendedIndex);
  const [inputValue, setInputValue] = useState("");

  const prefix = usePrefix({});

  useKeypress((key: KeypressEvent, rl) => {
    // Handle arrow keys
    if (isUpKey(key)) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }

    if (isDownKey(key)) {
      setCursor(Math.min(options.length, cursor + 1)); // length = custom input position
      return;
    }

    if (isEnterKey(key)) {
      // Submit
      if (cursor === options.length) {
        // Custom input selected
        const finalValue = inputValue.trim();
        if (finalValue) {
          done(finalValue);
        } else {
          // Empty custom input, use recommended
          done(options[recommendedIndex]);
        }
      } else {
        // Option selected
        done(options[cursor]);
      }
      return;
    }

    // Only allow typing when cursor is on custom input line
    if (cursor === options.length && key.name !== "return") {
      // Ctrl+W or Option+Delete - delete word backward
      if ((key.name === "w" && key.ctrl) || key.name === "backspace") {
        if (key.name === "w" && key.ctrl) {
          // Delete word backward
          const words = inputValue.trimEnd().split(/\s+/);
          if (words.length > 0) {
            words.pop();
            setInputValue(
              words.join(" ") + (inputValue.endsWith(" ") && words.length > 0 ? " " : "")
            );
          }
        } else {
          // Regular backspace
          setInputValue(inputValue.slice(0, -1));
        }
      }
      // Ctrl+U or Cmd+Delete - delete to beginning of line
      else if (key.name === "u" && key.ctrl) {
        setInputValue("");
      }
      // Space
      else if (key.name === "space") {
        setInputValue(inputValue + " ");
      }
      // Single character keys (letters, numbers, punctuation)
      else if (key.name && key.name.length === 1 && !key.ctrl) {
        setInputValue(inputValue + key.name);
      }
    } else {
      // When NOT on input line, clear any readline buffer to prevent cursor movement
      if (rl.line) {
        rl.line = "";
      }
    }
  });

  // Build the output
  let output = `${prefix} ${pc.bold(message)}\n\n`;

  // Render options
  options.forEach((opt: string, idx: number) => {
    const isRecommended = idx === recommendedIndex;
    const isCursor = idx === cursor;
    const number = pc.cyan(`${idx + 1}.`);
    const text = isRecommended ? `${opt} ${pc.green("✓ Recommended")}` : opt;

    if (isCursor) {
      output += pc.cyan(`❯ ${number} ${text}\n`);
    } else {
      output += `  ${number} ${text}\n`;
    }
  });

  // Render custom input option
  const isCustomCursor = cursor === options.length;
  if (isCustomCursor) {
    output += pc.cyan(`❯ ${pc.yellow("✎")} ${inputValue || pc.dim("Type your own...")}`);
  } else {
    output += `  ${pc.yellow("✎")} ${pc.dim("Type your own...")}`;
  }

  return output;
});

export default selectOrInput;

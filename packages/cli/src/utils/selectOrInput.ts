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

function reorderOptions(options: string[], recommendedIndex: number): string[] {
  if (recommendedIndex === 0) return options;
  const reordered = [options[recommendedIndex]];
  for (let i = 0; i < options.length; i++) {
    if (i !== recommendedIndex) reordered.push(options[i]);
  }
  return reordered;
}

const selectOrInput: (config: SelectOrInputConfig) => Promise<string> = createPrompt<
  string,
  SelectOrInputConfig
>((config, done): string => {
  const { message, options: rawOptions, recommendedIndex = 0 } = config;
  const options = reorderOptions(rawOptions, recommendedIndex);
  const [cursor, setCursor] = useState(0);
  const [inputValue, setInputValue] = useState("");

  const prefix = usePrefix({});

  useKeypress((key: KeypressEvent, rl) => {
    if (isUpKey(key)) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }

    if (isDownKey(key)) {
      setCursor(Math.min(options.length, cursor + 1));
      return;
    }

    if (isEnterKey(key)) {
      if (cursor === options.length) {
        const finalValue = inputValue.trim();
        done(finalValue || options[0]);
      } else {
        done(options[cursor]);
      }
      return;
    }

    // Text input handling (only when on custom input line)
    if (cursor === options.length && key.name !== "return") {
      if ((key.name === "w" && key.ctrl) || key.name === "backspace") {
        if (key.name === "w" && key.ctrl) {
          const words = inputValue.trimEnd().split(/\s+/);
          if (words.length > 0) {
            words.pop();
            setInputValue(
              words.join(" ") + (inputValue.endsWith(" ") && words.length > 0 ? " " : "")
            );
          }
        } else {
          setInputValue(inputValue.slice(0, -1));
        }
      } else if (key.name === "u" && key.ctrl) {
        setInputValue("");
      } else if (key.name === "space") {
        setInputValue(inputValue + " ");
      } else if (key.name && key.name.length === 1 && !key.ctrl) {
        setInputValue(inputValue + key.name);
      }
    } else if (rl.line) {
      rl.line = "";
    }
  });

  let output = `${prefix} ${pc.bold(message)}\n\n`;

  options.forEach((opt: string, idx: number) => {
    const isRecommended = idx === 0;
    const isCursor = idx === cursor;
    const number = pc.cyan(`${idx + 1}.`);
    const text = isRecommended ? `${opt} ${pc.green("✓ Recommended")}` : opt;

    if (isCursor) {
      output += pc.cyan(`❯ ${number} ${text}\n`);
    } else {
      output += `  ${number} ${text}\n`;
    }
  });

  const isCustomCursor = cursor === options.length;
  if (isCustomCursor) {
    output += pc.cyan(`❯ ${pc.yellow("✎")} ${inputValue || pc.dim("Type your own...")}`);
  } else {
    output += `  ${pc.yellow("✎")} ${pc.dim("Type your own...")}`;
  }

  return output;
});

export default selectOrInput;

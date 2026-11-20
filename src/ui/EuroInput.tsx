import { useEffect, useState, type InputHTMLAttributes } from "react";
import { formatAmount, parseEuro } from "../../shared/money";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  valueCents: number | null;
  onChange(cents: number | null): void;
};

const textOf = (cents: number | null) => (cents === null ? "" : formatAmount(cents));

/** A field for an amount in euros. It reports cents, or null while the text is not an amount. */
export function EuroInput({ valueCents, onChange, className = "", ...rest }: Props) {
  const [text, setText] = useState(textOf(valueCents));

  // Follow a value set from outside, but leave alone what the person is in the middle of typing.
  useEffect(() => {
    setText((current) => (parseEuro(current) === valueCents ? current : textOf(valueCents)));
  }, [valueCents]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseEuro(event.target.value));
      }}
      className={`min-h-11 rounded-xl border-2 border-ink/30 bg-white px-3 text-lg ${className}`}
      {...rest}
    />
  );
}

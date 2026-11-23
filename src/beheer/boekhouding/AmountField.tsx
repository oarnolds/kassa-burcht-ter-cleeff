import { useState } from "react";
import { parseEuro } from "../../../shared/money";
import { EuroInput } from "../../ui/EuroInput";

/** True when text was typed that is not an amount; an empty field is "no amount", not a mistake. */
const unreadable = (text: string): boolean => text.trim() !== "" && parseEuro(text) === null;

type Props = { label?: string; valueCents: number | null; onChange(cents: number | null): void; onUnreadable(bad: boolean): void; className?: string };

/** An amount field that says so when what is typed cannot be read, and tells its page. */
export function AmountField({ label, valueCents, onChange, onUnreadable, className = "" }: Props) {
  const [bad, setBad] = useState(false);
  return (
    <span className="flex flex-col items-end gap-1">
      <EuroInput
        aria-label={label}
        aria-invalid={bad || undefined}
        valueCents={valueCents}
        onChange={onChange}
        onText={(text) => {
          const now = unreadable(text);
          setBad(now);
          onUnreadable(now);
        }}
        className={className}
      />
      {bad && <span className="text-sm font-semibold text-redbrown">Dit bedrag kan ik niet lezen.</span>}
    </span>
  );
}

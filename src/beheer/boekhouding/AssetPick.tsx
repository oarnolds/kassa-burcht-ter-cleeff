import { useState } from "react";
import { MAX_LIFE_YEARS, readLifeYears } from "../../../shared/asset-paste";
import type { Asset } from "../../../shared/ledger-types";
import { field } from "../parts";
import { AmountField } from "./AmountField";

/** The account a bank line buys a toestel on. */
export const ASSET_ACCOUNT = "0130";
/** The choice in the list for a toestel that is not in it yet. */
export const NEW_ASSET = "nieuw";

/** Which toestel a part on 0130 buys: one of the list (its id), a new one (with what it needs), or none chosen yet. */
export type AssetChoice = { asset: string; name: string; years: string; residualCents: number | null; residualBad: boolean };

export const noAsset = (): AssetChoice => ({ asset: "", name: "", years: "", residualCents: null, residualBad: false });

/** Ready to book: a toestel of the list, or a new one with a name and a life of 1 to 50 years. */
export const assetReady = (choice: AssetChoice): boolean =>
  choice.asset !== "" &&
  (choice.asset !== NEW_ASSET || (choice.name.trim() !== "" && choice.name.trim().length <= 60 && readLifeYears(choice.years) !== null && !choice.residualBad));

const label = "flex flex-col gap-1 text-sm font-semibold";

/**
 * Chooses the toestel a line on 0130 buys, or makes a new one: name, life in years and residual value. `onChange`
 * gets only what changed: one keystroke in an amount reports both the amount and whether it can be read.
 */
export function AssetPick({ assets, value, onChange, suffix = "" }: { assets: Asset[]; value: AssetChoice; onChange(part: Partial<AssetChoice>): void; suffix?: string }) {
  const [typedYears, setTypedYears] = useState(false);
  const inUse = assets.filter((asset) => asset.disposedOn === null);
  return (
    <div className="flex flex-col gap-2">
      <select aria-label={`Toestel${suffix}`} className={`${field} min-w-0 max-w-full`} value={value.asset} onChange={(event) => onChange({ asset: event.target.value })}>
        <option value="">Kies een toestel</option>
        {inUse.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
        <option value={NEW_ASSET}>Nieuw toestel</option>
      </select>
      {value.asset === NEW_ASSET && (
        <div className="flex flex-wrap items-start gap-2">
          <label className={label}>
            Naam
            <input
              aria-label={`Naam van het toestel${suffix}`}
              type="text"
              maxLength={60}
              className={field}
              value={value.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </label>
          <label className={label}>
            Jaren
            <input
              aria-label={`Levensduur in jaren${suffix}`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={`${field} w-24`}
              value={value.years}
              onChange={(event) => {
                setTypedYears(true);
                onChange({ years: event.target.value });
              }}
            />
            {typedYears && readLifeYears(value.years) === null && <span className="text-redbrown">{`1 tot ${MAX_LIFE_YEARS} jaar`}</span>}
          </label>
          <div className={label}>
            <span>Restwaarde</span>
            <AmountField
              label={`Restwaarde${suffix}`}
              valueCents={value.residualCents}
              onChange={(residualCents) => onChange({ residualCents })}
              onUnreadable={(residualBad) => onChange({ residualBad })}
              className="w-32 text-right tabular-nums"
            />
          </div>
        </div>
      )}
    </div>
  );
}

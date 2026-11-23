import { useState } from "react";
import { Link } from "react-router";
import type { BankLine, LedgerAccount, MoneyAccount } from "../../../shared/ledger-types";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Problem, Section, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { BankLineRow, type BookedNotice } from "./BankLineRow";
import { BankUpload, bankAccounts } from "./BankUpload";
import { entryRoute, ledgerPath } from "./ledger-api";
import { TypedLine } from "./TypedLine";

/** Bank lines that wait for the penningmeester: read a file, type a line, book what is left. */
export function ToBookPage() {
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const money = useAdminData<MoneyAccount[]>(ledgerPath.moneyAccounts);
  const lines = useAdminData<BankLine[]>(ledgerPath.bankLines);
  const [typing, setTyping] = useState(false);
  const [notice, setNotice] = useState<BookedNotice | null>(null);

  return (
    <div>
      <PageTitle>{lines.data ? `Te boeken (${lines.data.filter((line) => line.status === "open").length})` : "Te boeken"}</PageTitle>
      <Loaded from={money}>
        {(list) => (
          <>
            <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-4">
              {bankAccounts(list).map((account) => (
                <div key={account.accountCode} className="flex flex-col gap-2">
                  <h2 className="text-lg font-bold">{`${account.accountCode} ${account.name}`}</h2>
                  <BankUpload account={account} onDone={lines.reload} />
                </div>
              ))}
            </div>
            <p className="mt-4">
              <Button onClick={() => setTyping(!typing)}>Regel intypen</Button>
            </p>
            {typing && <TypedLine accounts={bankAccounts(list)} onAdded={lines.reload} />}
          </>
        )}
      </Loaded>
      {notice?.attachmentProblem && (
        <div className="mt-4 flex flex-col items-start">
          <Problem>{`De boeking staat erin, maar de bijlage is niet opgeslagen: ${notice.attachmentProblem}`}</Problem>
          <Link className={`${textLink} inline-flex min-h-11 items-center`} to={entryRoute(notice.entryId)}>
            Naar de boeking
          </Link>
        </div>
      )}
      <Loaded from={accounts}>
        {(accountList) => (
          <Loaded from={lines}>
            {(list) => (
              <Section title="Regels">
                {list.length === 0 ? (
                  <p className="px-2 text-lg text-ink/70 sm:px-3">Er is niets te boeken.</p>
                ) : (
                  <ul>
                    {list.map((line) => (
                      <BankLineRow
                        key={line.id}
                        line={line}
                        accounts={accountList}
                        onBooked={(done) => {
                          setNotice(done);
                          lines.reload();
                        }}
                      />
                    ))}
                  </ul>
                )}
              </Section>
            )}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

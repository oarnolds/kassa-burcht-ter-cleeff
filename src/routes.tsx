import { type ComponentType, lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { BeheerLayout } from "./beheer/BeheerLayout";
import { CashPage } from "./beheer/CashPage";
import { DashboardPage } from "./beheer/DashboardPage";
import { LoginPage } from "./beheer/LoginPage";
import { ProductsPage } from "./beheer/ProductsPage";
import { ReportsPage } from "./beheer/ReportsPage";
import { SalesPage } from "./beheer/SalesPage";
import { SettingsPage } from "./beheer/SettingsPage";
import { SetupPage } from "./beheer/SetupPage";
import { StockPage } from "./beheer/StockPage";
import { LedgerLayout, PageLoading } from "./beheer/boekhouding/LedgerLayout";
import { KassaPage } from "./kassa/KassaPage";
import { PairPage } from "./kassa/PairPage";
import { Logo } from "./ui/Logo";

// The boekhouding's pages come in one chunk of their own, loaded when beheer first opens one (R38), so the kassa's
// start bundle on the iPad does not carry them.
type LedgerPages = typeof import("./beheer/boekhouding/pages");
const ledgerPage = (name: keyof LedgerPages) => lazy(() => import("./beheer/boekhouding/pages").then((pages) => ({ default: pages[name] as ComponentType })));
const AssetsPage = ledgerPage("AssetsPage");
const BankReturnPage = ledgerPage("BankReturnPage");
const ComparisonPage = ledgerPage("ComparisonPage");
const EarlierYearsPage = ledgerPage("EarlierYearsPage");
const EntriesPage = ledgerPage("EntriesPage");
const EntryPage = ledgerPage("EntryPage");
const MolliePage = ledgerPage("MolliePage");
const OpeningPage = ledgerPage("OpeningPage");
const OverviewPage = ledgerPage("OverviewPage");
const PrintYearPage = ledgerPage("PrintYearPage");
const ReportsLedgerPage = ledgerPage("ReportsLedgerPage");
const SettingsLedgerPage = ledgerPage("SettingsLedgerPage");
const ToBookPage = ledgerPage("ToBookPage");
const YearPage = ledgerPage("YearPage");

function Placeholder({ title }: { title: string }) {
  return (
    <main className="p-6">
      <Logo />
      <h1 className="mt-6 text-2xl font-bold">{title}</h1>
    </main>
  );
}

/** Every page of the app. `/` is the kassa on the iPad; everything under `/beheer` is for the penningmeester. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<KassaPage />} />
      <Route path="/koppelen" element={<PairPage />} />
      <Route path="/beheer/login" element={<LoginPage />} />
      <Route path="/beheer/instellen" element={<SetupPage />} />
      <Route path="/beheer" element={<BeheerLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="rapporten" element={<ReportsPage />} />
        <Route path="verkopen" element={<SalesPage />} />
        <Route path="kluisje" element={<CashPage />} />
        <Route path="voorraad" element={<StockPage />} />
        <Route path="producten" element={<ProductsPage />} />
        <Route path="boekhouding" element={<LedgerLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="te-boeken" element={<ToBookPage />} />
          <Route path="boekingen" element={<EntriesPage />} />
          <Route path="boekingen/:id" element={<EntryPage />} />
          <Route path="rapporten" element={<ReportsLedgerPage />} />
          <Route path="mollie" element={<MolliePage />} />
          <Route path="toestellen" element={<AssetsPage />} />
          <Route path="jaar" element={<YearPage />} />
          <Route path="jaar/:year/afdruk" element={<PrintYearPage />} />
          <Route path="instellingen" element={<SettingsLedgerPage />} />
          <Route path="beginbalans" element={<OpeningPage />} />
          <Route path="vergelijking" element={<ComparisonPage />} />
          <Route path="eerdere-jaren" element={<EarlierYearsPage />} />
        </Route>
        <Route
          path="bank"
          element={
            <Suspense fallback={<PageLoading />}>
              <BankReturnPage />
            </Suspense>
          }
        />
        <Route path="instellingen" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Placeholder title="Pagina niet gevonden" />} />
    </Routes>
  );
}

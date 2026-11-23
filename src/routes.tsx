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
import { ComparisonPage } from "./beheer/boekhouding/ComparisonPage";
import { LedgerLayout } from "./beheer/boekhouding/LedgerLayout";
import { OpeningPage } from "./beheer/boekhouding/OpeningPage";
import { LedgerPlaceholder, YearPlaceholder } from "./beheer/boekhouding/Placeholder";
import { SettingsLedgerPage } from "./beheer/boekhouding/SettingsLedgerPage";
import { KassaPage } from "./kassa/KassaPage";
import { PairPage } from "./kassa/PairPage";
import { Logo } from "./ui/Logo";

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
          <Route index element={<LedgerPlaceholder title="Overzicht" />} />
          <Route path="te-boeken" element={<LedgerPlaceholder title="Te boeken" />} />
          <Route path="boekingen" element={<LedgerPlaceholder title="Boekingen" />} />
          <Route path="boekingen/:id" element={<LedgerPlaceholder title="Boeking" />} />
          <Route path="rapporten" element={<LedgerPlaceholder title="Rapporten" />} />
          <Route path="mollie" element={<LedgerPlaceholder title="Mollie" />} />
          <Route path="toestellen" element={<LedgerPlaceholder title="Toestellen" />} />
          <Route path="jaar" element={<YearPlaceholder />} />
          <Route path="jaar/:year/afdruk" element={<LedgerPlaceholder title="Afdruk" />} />
          <Route path="instellingen" element={<SettingsLedgerPage />} />
          <Route path="beginbalans" element={<OpeningPage />} />
          <Route path="vergelijking" element={<ComparisonPage />} />
        </Route>
        <Route path="instellingen" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Placeholder title="Pagina niet gevonden" />} />
    </Routes>
  );
}

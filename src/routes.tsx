import { Route, Routes } from "react-router";
import { BeheerLayout } from "./beheer/BeheerLayout";
import { DashboardPage } from "./beheer/DashboardPage";
import { LoginPage } from "./beheer/LoginPage";
import { PageTitle } from "./beheer/parts";
import { ReportsPage } from "./beheer/ReportsPage";
import { SalesPage } from "./beheer/SalesPage";
import { SetupPage } from "./beheer/SetupPage";
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
        <Route path="kluisje" element={<PageTitle>Kluisje</PageTitle>} />
        <Route path="voorraad" element={<PageTitle>Voorraad</PageTitle>} />
        <Route path="producten" element={<PageTitle>Producten</PageTitle>} />
        <Route path="instellingen" element={<PageTitle>Instellingen</PageTitle>} />
      </Route>
      <Route path="*" element={<Placeholder title="Pagina niet gevonden" />} />
    </Routes>
  );
}

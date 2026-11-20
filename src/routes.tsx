import { Route, Routes } from "react-router";
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
      <Route path="/" element={<Placeholder title="Kassa" />} />
      <Route path="/koppelen" element={<Placeholder title="iPad koppelen" />} />
      <Route path="/beheer" element={<Placeholder title="Beheer" />} />
      <Route path="/beheer/login" element={<Placeholder title="Inloggen" />} />
      <Route path="/beheer/instellen" element={<Placeholder title="Beheer instellen" />} />
      <Route path="/beheer/rapporten" element={<Placeholder title="Rapporten" />} />
      <Route path="/beheer/verkopen" element={<Placeholder title="Verkopen" />} />
      <Route path="/beheer/kluisje" element={<Placeholder title="Kluisje" />} />
      <Route path="/beheer/voorraad" element={<Placeholder title="Voorraad" />} />
      <Route path="/beheer/producten" element={<Placeholder title="Producten" />} />
      <Route path="/beheer/instellingen" element={<Placeholder title="Instellingen" />} />
      <Route path="*" element={<Placeholder title="Pagina niet gevonden" />} />
    </Routes>
  );
}

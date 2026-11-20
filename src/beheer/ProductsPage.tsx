import { useState, type FormEvent } from "react";
import { formatEuro } from "../../shared/money";
import type { AdminProduct, Category, ColorKey } from "../../shared/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EuroInput } from "../ui/EuroInput";
import { colorKeys, colorLabels, tileColors } from "../ui/palette";
import { useToast } from "../ui/Toast";
import { Loaded, PageTitle, Problem, Section, cell, field, table } from "./parts";
import { useAdminData, useAdminWrite } from "./useAdmin";

type Data = { categories: Category[]; products: AdminProduct[] };

const label = "flex flex-col gap-1 text-lg font-semibold";
const check = "flex min-h-11 items-center gap-3 text-lg";
const box = "h-6 w-6 shrink-0 accent-green-dark";
const badge = "rounded-full px-3 py-0.5 text-sm font-semibold";

const refusal = (status: number) => (status === 0 ? "Geen verbinding. Probeer het opnieuw." : "Opslaan is niet gelukt. Controleer wat je hebt ingevuld.");

/** A whole number within a range; `null` for an empty field, `undefined` for anything else. */
function optionalWhole(text: string, min: number, max: number): number | null | undefined {
  const typed = text.trim();
  if (typed === "") return null;
  if (!/^\d+$/.test(typed)) return undefined;
  const n = Number(typed);
  return n >= min && n <= max ? n : undefined;
}

type ProductFormProps = { product: AdminProduct | null; categories: Category[]; onDone(message?: string): void; onClose(): void };

/** Everything about one product. Also the form for a new one. */
function ProductForm({ product, categories, onDone, onClose }: ProductFormProps) {
  const [name, setName] = useState(product?.name ?? "");
  const [priceCents, setPriceCents] = useState<number | null>(product?.priceCents ?? null);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [quantityPad, setQuantityPad] = useState(product?.quantityPad ?? false);
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? false);
  const [unitsPerBox, setUnitsPerBox] = useState(product?.unitsPerBox?.toString() ?? "");
  const [reorderAt, setReorderAt] = useState(product?.reorderAt?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (priceCents === null) return;
    // Hidden fields keep what the product had: switching stock keeping back on brings them back.
    const units = trackStock ? optionalWhole(unitsPerBox, 1, 500) : (product?.unitsPerBox ?? null);
    const reorder = trackStock ? optionalWhole(reorderAt, 0, 10_000) : (product?.reorderAt ?? null);
    if (units === undefined) return setError("Stuks per doos is een heel getal van 1 tot 500.");
    if (reorder === undefined) return setError("Bestelgrens is een heel getal van 0 tot 10.000.");
    const fields = { name: name.trim(), priceCents, categoryId, quantityPad, trackStock, unitsPerBox: units, reorderAt: reorder };

    setBusy(true);
    setError(null);
    let answer;
    if (product) {
      answer = await write<AdminProduct>(`/api/admin/products/${encodeURIComponent(product.id)}`, "PATCH", { ...fields, active });
    } else {
      answer = await write<AdminProduct>("/api/admin/products", "POST", fields);
      // A new product starts visible; one that should not be on the kassa yet is hidden straight away.
      if (answer.ok && !active) {
        const hidden = await write<AdminProduct>(`/api/admin/products/${encodeURIComponent(answer.data.id)}`, "PATCH", { active: false });
        // The product exists by now: asking again would make a second one.
        if (!hidden.ok) return onDone(`${fields.name} is toegevoegd, maar verbergen is niet gelukt. Verberg het via Bewerken.`);
      }
    }
    if (answer.ok) return onDone();
    setBusy(false);
    setError(refusal(answer.status));
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <label className={label}>
        Naam
        <input className={field} maxLength={40} autoFocus={product === null} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={label}>
        Prijs
        <EuroInput valueCents={priceCents} onChange={setPriceCents} />
      </label>
      <label className={label}>
        Categorie
        <select className={field} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className={check}>
        <input className={box} type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Zichtbaar op de kassa
      </label>
      <label className={check}>
        <input className={box} type="checkbox" checked={quantityPad} onChange={(event) => setQuantityPad(event.target.checked)} />
        Opent een cijferblok voor het aantal
      </label>
      <label className={check}>
        <input className={box} type="checkbox" checked={trackStock} onChange={(event) => setTrackStock(event.target.checked)} />
        Voorraad bijhouden
      </label>
      {trackStock && (
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Stuks per doos
            <input className={field} type="number" inputMode="numeric" min={1} max={500} value={unitsPerBox} onChange={(event) => setUnitsPerBox(event.target.value)} />
          </label>
          <label className={label}>
            Bestelgrens (stuks)
            <input className={field} type="number" inputMode="numeric" min={0} max={10000} value={reorderAt} onChange={(event) => setReorderAt(event.target.value)} />
          </label>
        </div>
      )}
      {error && <Problem>{error}</Problem>}
      <div className="mt-2 flex justify-end gap-3">
        <Button onClick={onClose}>Annuleren</Button>
        <Button type="submit" variant="primary" disabled={busy || name.trim() === "" || priceCents === null || categoryId === ""}>
          Opslaan
        </Button>
      </div>
    </form>
  );
}

/** The name of a category, and for a new one its colour. */
function CategoryForm({ category, onDone, onClose }: { category: Category | null; onDone(): void; onClose(): void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState<ColorKey>("green");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const answer = category
      ? await write<Category>(`/api/admin/categories/${encodeURIComponent(category.id)}`, "PATCH", { name: name.trim() })
      : await write<Category>("/api/admin/categories", "POST", { name: name.trim(), color });
    if (answer.ok) return onDone();
    setBusy(false);
    setError(refusal(answer.status));
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <label className={label}>
        Categorienaam
        <input className={field} maxLength={40} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {!category && (
        <label className={label}>
          Kleur
          <select className={field} value={color} onChange={(event) => setColor(event.target.value as ColorKey)}>
            {colorKeys.map((key) => (
              <option key={key} value={key}>
                {colorLabels[key]}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <Problem>{error}</Problem>}
      <div className="mt-2 flex justify-end gap-3">
        <Button onClick={onClose}>Annuleren</Button>
        <Button type="submit" variant="primary" disabled={busy || name.trim() === ""}>
          Opslaan
        </Button>
      </div>
    </form>
  );
}

type ListProps = { data: Data; busy: boolean; onEdit(product: AdminProduct): void; onMove(ids: string[]): void };

/** The products as the kassa shows them: per category, in tile order. */
function ProductList({ data, busy, onEdit, onMove }: ListProps) {
  return (
    <>
      {data.categories.map((category) => {
        const products = data.products.filter((product) => product.categoryId === category.id).sort((a, b) => a.sort - b.sort);
        // The category's products with two neighbours traded.
        const swapped = (from: number, to: number) => {
          const ids = products.map((product) => product.id);
          [ids[from], ids[to]] = [ids[to]!, ids[from]!];
          return ids;
        };
        return (
          <Section key={category.id} title={category.name}>
            {products.length === 0 ? (
              <p className="px-2 text-lg text-ink/70 sm:px-3">Nog geen producten in deze categorie.</p>
            ) : (
              <table className={table}>
                <tbody>
                  {products.map((product, index) => (
                    <tr key={product.id} className="border-b border-sand last:border-b-0">
                      {/* One cell, so that on a phone the buttons can drop below the name. */}
                      <td className={cell}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div className="min-w-0 flex-1 basis-40">
                            <span className={`block text-lg font-semibold ${product.active ? "" : "text-ink/50"}`}>{product.name}</span>
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="tabular-nums">{formatEuro(product.priceCents)}</span>
                              {!product.active && <span className={`${badge} bg-sand text-ink`}>Verborgen</span>}
                              {product.trackStock && <span className={`${badge} bg-[#DCE7EE] text-[#1F4257]`}>Voorraad</span>}
                            </span>
                          </div>
                          <div className="ml-auto flex gap-2">
                            <Button aria-label="Omhoog" title="Omhoog" className="px-3" disabled={busy || index === 0} onClick={() => onMove(swapped(index, index - 1))}>
                              ↑
                            </Button>
                            <Button
                              aria-label="Omlaag"
                              title="Omlaag"
                              className="px-3"
                              disabled={busy || index === products.length - 1}
                              onClick={() => onMove(swapped(index, index + 1))}
                            >
                              ↓
                            </Button>
                            <Button className="px-4" onClick={() => onEdit(product)}>
                              Bewerken
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        );
      })}
    </>
  );
}

type CategoriesProps = { categories: Category[]; onColor(category: Category, color: ColorKey): void; onRename(category: Category): void; onNew(): void };

function Categories({ categories, onColor, onRename, onNew }: CategoriesProps) {
  return (
    <Section title="Categorieën" note="De kleur is die van de tegels op de kassa.">
      <ul className="flex flex-col px-2 sm:px-3">
        {categories.map((category) => (
          <li key={category.id} className="flex flex-wrap items-center gap-3 border-b border-sand py-2">
            <span
              aria-hidden="true"
              className="h-8 w-8 shrink-0 rounded-lg border-2"
              style={{ backgroundColor: tileColors[category.color].bg, borderColor: tileColors[category.color].border }}
            />
            <span className="min-w-32 flex-1 text-lg font-semibold">{category.name}</span>
            <select
              className={field}
              aria-label={`Kleur van ${category.name}`}
              value={category.color}
              onChange={(event) => onColor(category, event.target.value as ColorKey)}
            >
              {colorKeys.map((key) => (
                <option key={key} value={key}>
                  {colorLabels[key]}
                </option>
              ))}
            </select>
            <Button onClick={() => onRename(category)}>Naam wijzigen</Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 px-2 sm:px-3">
        <Button onClick={onNew}>Nieuwe categorie</Button>
      </div>
    </Section>
  );
}

/** What the kassa sells: names, prices, the order of the tiles, and the categories with their colours. */
export function ProductsPage() {
  const list = useAdminData<Data>("/api/admin/products");
  const [product, setProduct] = useState<AdminProduct | "new" | null>(null);
  const [category, setCategory] = useState<Category | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();
  const toast = useToast();

  // A change that needs no dialog: the order of the tiles, the colour of a category.
  const change = async (path: string, method: string, json: unknown) => {
    setBusy(true);
    const answer = await write(path, method, json);
    setBusy(false);
    if (!answer.ok) toast.show(answer.status === 0 ? "Geen verbinding. Probeer het opnieuw." : "Dat lukte niet. Probeer het opnieuw.");
    list.reload();
  };

  /** Closes the dialog. A message means it went half right: that one stays up long enough to read. */
  const saved = (message?: string) => {
    setProduct(null);
    setCategory(null);
    if (message) toast.show(message, { ms: 12_000 });
    else toast.show("Opgeslagen");
    list.reload();
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Producten</PageTitle>
        <Button variant="primary" disabled={!list.data || list.data.categories.length === 0} onClick={() => setProduct("new")}>
          Nieuw product
        </Button>
      </div>
      <p className="mt-2 text-lg text-ink/70">Een wijziging staat binnen een halve minuut op de kassa.</p>

      <Loaded from={list}>
        {(data) => (
          <>
            <ProductList data={data} busy={busy} onEdit={setProduct} onMove={(ids) => void change("/api/admin/products/order", "PUT", { ids })} />
            <Categories
              categories={data.categories}
              onColor={(which, color) => void change(`/api/admin/categories/${encodeURIComponent(which.id)}`, "PATCH", { color })}
              onRename={setCategory}
              onNew={() => setCategory("new")}
            />
          </>
        )}
      </Loaded>

      <Dialog open={product !== null} onClose={() => setProduct(null)} title={product === "new" ? "Nieuw product" : "Product bewerken"}>
        {product !== null && list.data && (
          <ProductForm product={product === "new" ? null : product} categories={list.data.categories} onDone={saved} onClose={() => setProduct(null)} />
        )}
      </Dialog>
      <Dialog open={category !== null} onClose={() => setCategory(null)} title={category === "new" ? "Nieuwe categorie" : "Naam wijzigen"}>
        {category !== null && <CategoryForm category={category === "new" ? null : category} onDone={() => saved()} onClose={() => setCategory(null)} />}
      </Dialog>
    </>
  );
}

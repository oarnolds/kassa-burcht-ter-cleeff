import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

// White on the house green is only readable at 18 px bold or larger, so the primary button is always that big.
const variants: Record<Variant, string> = {
  primary: "bg-green text-white text-lg font-bold border-2 border-green enabled:active:bg-green-dark",
  secondary: "bg-white text-ink font-semibold border-2 border-ink enabled:active:bg-sand",
  danger: "bg-redbrown text-white font-semibold border-2 border-redbrown enabled:active:opacity-80",
  ghost: "bg-transparent text-ink font-semibold border-2 border-transparent enabled:active:bg-sand",
};

const sizes: Record<Size, string> = {
  md: "min-h-11 px-5 py-2",
  lg: "min-h-16 px-8 py-3 text-xl",
};

/** A pill-shaped button, at least 44 px high. It does not submit a form unless `type="submit"` is given. */
export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-full select-none disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    />
  );
}

import type { ColorKey } from "../../shared/types";

/** The colours of the kassa tiles, per category colour. The text colour is dark enough to read on its background. */
export const tileColors: Record<ColorKey, { bg: string; border: string; text: string }> = {
  rose: { bg: "#F6DDE2", border: "#E3A9B5", text: "#6E1F33" },
  blue: { bg: "#DCE7EE", border: "#A9C3D4", text: "#1F4257" },
  brown: { bg: "#EADBCB", border: "#CFAE8C", text: "#5A3113" },
  yellow: { bg: "#F5E7BF", border: "#E0C36A", text: "#5E4500" },
  green: { bg: "#E1EACB", border: "#B5C98A", text: "#3F5512" },
  grey: { bg: "#E0E1DA", border: "#BFC1B6", text: "#3A3B36" },
};

export const colorLabels: Record<ColorKey, string> = {
  rose: "Roze",
  blue: "Blauw",
  brown: "Bruin",
  yellow: "Geel",
  green: "Groen",
  grey: "Grijs",
};

export const colorKeys = Object.keys(colorLabels) as ColorKey[];

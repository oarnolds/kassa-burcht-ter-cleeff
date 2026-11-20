import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { render } from "../test-utils";
import { StatusBadge } from "./StatusBadge";

const state = { online: true, pending: 0, rejected: 0, paired: true };

it("says online, and nothing else, when all is well", () => {
  render(<StatusBadge state={state} />);
  expect(screen.getByText("Online")).toBeInTheDocument();
  expect(screen.queryByText(/verzending|afgekeurd|ontkoppeld/)).not.toBeInTheDocument();
});

it("says that cash goes on while offline", () => {
  render(<StatusBadge state={{ ...state, online: false }} />);
  expect(screen.getByText("Offline · contant werkt door")).toBeInTheDocument();
  expect(screen.queryByText("Online")).not.toBeInTheDocument();
});

it("counts what waits and what was refused, in one or more", () => {
  const { rerender } = render(<StatusBadge state={{ ...state, pending: 1, rejected: 1 }} />);
  expect(screen.getByText("1 verkoop wacht op verzending")).toBeInTheDocument();
  expect(screen.getByText("1 verkoop afgekeurd, meld dit aan de penningmeester")).toBeInTheDocument();
  rerender(<StatusBadge state={{ ...state, pending: 12, rejected: 2 }} />);
  expect(screen.getByText("12 verkopen wachten op verzending")).toBeInTheDocument();
  expect(screen.getByText("2 verkopen afgekeurd, meld dit aan de penningmeester")).toBeInTheDocument();
});

it("explains an unpaired kassa and links to pairing", () => {
  render(<StatusBadge state={{ ...state, paired: false, pending: 3 }} />);
  expect(screen.getByText("Kassa is ontkoppeld. Vraag de penningmeester om een nieuwe koppelcode.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Opnieuw koppelen" })).toHaveAttribute("href", "/koppelen");
  expect(screen.getByText("3 verkopen wachten op verzending")).toBeInTheDocument();
  expect(screen.queryByText("Online")).not.toBeInTheDocument();
});

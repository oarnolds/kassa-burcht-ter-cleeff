import { pillLink } from "../parts";

/** A button that picks a PDF or a photo (on a phone also with the camera) and hands the file to its page. */
export function AttachmentButton({ label, onPick, disabled = false }: { label: string; onPick(file: File): void; disabled?: boolean }) {
  return (
    <label className={`${pillLink} relative cursor-pointer has-[:disabled]:opacity-40 has-[:focus-visible]:outline-2`}>
      {label}
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        disabled={disabled}
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
    </label>
  );
}

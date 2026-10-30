"use client";

import { ImagePlus, Star, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useCan } from "@/modules/auth/hooks";

import { deleteImage, makePrimaryImage, uploadImage } from "../api";
import type { Product } from "../types";

const MAX_IMAGES = 8;
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Product photos: upload (JPEG/PNG/WebP up to 2 MB), choose the primary one, delete. */
export function ProductImages({ product, onChanged }: { product: Product; onChanged: () => Promise<void> }) {
  const canManage = useCan("products.manage");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files).slice(0, MAX_IMAGES - product.images.length);
    const invalid = list.find((f) => !TYPES.includes(f.type) || f.size > MAX_BYTES);
    if (invalid) {
      setError(`${invalid.name}: use a JPEG, PNG or WebP image up to 2 MB.`);
      return;
    }
    setBusy(true);
    try {
      for (const file of list) await uploadImage(product.id, file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      await onChanged();
    }
  };

  const full = product.images.length >= MAX_IMAGES;

  return (
    <Panel
      title="Images"
      description={`Up to ${MAX_IMAGES} photos. The primary photo shows in lists and at the point of sale.`}
      action={canManage && (
        <>
          <input ref={input} type="file" accept={TYPES.join(",")} multiple hidden aria-label="Choose images" onChange={(e) => upload(e.target.files)} />
          <Button size="sm" variant="outline" disabled={busy || full} onClick={() => input.current?.click()}>
            <ImagePlus aria-hidden /> {busy ? "Uploading…" : "Upload"}
          </Button>
        </>
      )}
    >
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      {product.images.length === 0 ? (
        <EmptyState icon={ImagePlus} title="No photos yet">A clear photo helps cashiers pick the right item.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {product.images.map((image) => (
            <li key={image.id} className="grid gap-2 rounded-lg border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- API-served image; static export has no image optimizer */}
              <img src={image.url} alt={product.name} className="aspect-square w-full rounded-md bg-muted object-contain" loading="lazy" />
              <div className="flex items-center justify-between gap-1">
                {image.is_primary ? (
                  <StatusBadge tone="info" icon={Star}>Primary</StatusBadge>
                ) : canManage ? (
                  <Button size="xs" variant="ghost" onClick={async () => { await makePrimaryImage(image.id); await onChanged(); }}>Make primary</Button>
                ) : <span />}
                {canManage && (
                  <ConfirmDialog
                    trigger={<Button size="icon-sm" variant="ghost" aria-label="Delete image"><Trash2 aria-hidden /></Button>}
                    title="Delete this photo?"
                    description="The file is removed from the server."
                    confirmLabel="Delete"
                    destructive
                    onConfirm={async () => { await deleteImage(image.id); await onChanged(); }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

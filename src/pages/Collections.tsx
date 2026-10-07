import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Copy, Globe, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { Loading } from "@/components/feed/loading";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/format";

export default function Collections() {
  const collections = useQuery(api.collections.mine);
  const saved = useQuery(api.feed.library, { kind: "saved" });
  const create = useMutation(api.collections.create);
  const update = useMutation(api.collections.update);
  const addProject = useMutation(api.collections.addProject);
  const removeProject = useMutation(api.collections.removeProject);
  const removeCollection = useMutation(api.collections.remove);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Id<"collections"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  // The owner can open their own collection even before it is public.
  const detail = useQuery(
    api.collections.shared,
    editing ? { collectionId: editing } : "skip",
  );
  const current = collections?.find((collection) => collection._id === editing);

  const openEditor = (collection: {
    _id: Id<"collections">;
    name: string;
    description: string | null;
  }) => {
    setEditing(collection._id);
    setEditName(collection.name);
    setEditDescription(collection.description ?? "");
  };

  const shareLink = (collectionId: string) =>
    `${window.location.origin}/c/${collectionId}`;

  const copyLink = (collectionId: string) => {
    void navigator.clipboard
      .writeText(shareLink(collectionId))
      .then(() => toast.success("Share link copied."))
      .catch(() => toast.error("Could not copy the link."));
  };

  const onCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await create({ name, description: description || undefined });
      setName("");
      setDescription("");
      toast.success("Collection created.");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setCreating(false);
    }
  };

  const run = (action: () => Promise<unknown>, failure: string) => {
    void action().catch((error) => toast.error(errorText(error) || failure));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="collections" />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Curated shelves
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Collections
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Group projects into shelves — “my keyboard builds”, “2026 finds” —
              and share them by link.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/dashboard">Saved projects</Link>
          </Button>
        </div>

        <form
          onSubmit={onCreate}
          className="mt-6 flex flex-wrap items-center gap-2"
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Collection name"
            aria-label="Collection name"
            className="h-9 w-48"
          />
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is it about? (optional)"
            aria-label="Collection description"
            className="h-9 w-64"
          />
          <Button
            type="submit"
            size="sm"
            disabled={creating || !name.trim()}
            className="gap-1.5"
          >
            <Plus className="size-3.5" />
            New collection
          </Button>
        </form>

        {collections === undefined ? (
          <Loading label="Loading collections…" />
        ) : collections.length === 0 ? (
          <div className="py-20 text-center">
            <Globe className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-medium">No collections yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Name one above, then add the projects you want to share with it.
            </p>
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {collections.map((collection) => (
              <li
                key={collection._id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium tracking-tight">
                    {collection.name}
                    {collection.isPublic && (
                      <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                        Public
                      </span>
                    )}
                  </p>
                  {collection.description && (
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {collection.description}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {collection.count}{" "}
                    {collection.count === 1 ? "project" : "projects"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditor(collection)}
                  >
                    Manage
                  </Button>
                  {collection.isPublic && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={() => copyLink(collection._id)}
                    >
                      <Copy className="size-3.5" />
                      Share
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </motion.main>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 pr-12 text-left">
            <DialogTitle className="text-lg tracking-tight">
              {current?.name ?? "Collection"}
            </DialogTitle>
            <DialogDescription>
              Rename it, choose who can see it, and pick its projects.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-6">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                aria-label="Collection name"
                className="h-9 w-44"
              />
              <Input
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                placeholder="Description (optional)"
                aria-label="Collection description"
                className="h-9 w-60"
              />
              <Button
                size="sm"
                disabled={!editName.trim()}
                onClick={() =>
                  editing &&
                  run(
                    () =>
                      update({
                        collectionId: editing,
                        name: editName,
                        description: editDescription,
                      }),
                    "Could not save changes.",
                  )
                }
              >
                Save
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={current?.isPublic ? "default" : "outline"}
                className="gap-1.5"
                onClick={() =>
                  editing &&
                  run(
                    () =>
                      update({
                        collectionId: editing,
                        isPublic: !current?.isPublic,
                      }),
                    "Could not change visibility.",
                  )
                }
              >
                <Globe className="size-3.5" />
                {current?.isPublic ? "Public" : "Private"}
              </Button>
              {current?.isPublic && editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => copyLink(editing)}
                >
                  <Copy className="size-3.5" />
                  Copy share link
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (!editing) return;
                  const id = editing;
                  setEditing(null);
                  run(
                    () => removeCollection({ collectionId: id }),
                    "Could not delete the collection.",
                  );
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>

            <div>
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                In this collection
              </p>
              {detail === undefined ? (
                <Loading label="Loading projects…" />
              ) : !detail || detail.items.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing here yet — add saved projects below.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border border-y border-border">
                  {detail.items.map((item) => (
                    <li
                      key={item.repoId}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.fullName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.description ?? "No description provided."}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() =>
                          editing &&
                          run(
                            () =>
                              removeProject({
                                collectionId: editing,
                                repoId: item.repoId,
                              }),
                            "Could not remove the project.",
                          )
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                Add from saved
              </p>
              {(saved?.items ?? []).filter(
                (item) => !current?.repoIds.includes(item.repoId),
              ).length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing to add — save projects while exploring first.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border border-y border-border">
                  {(saved?.items ?? [])
                    .filter((item) => !current?.repoIds.includes(item.repoId))
                    .map((item) => (
                      <li
                        key={item.repoId}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {item.fullName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.description ?? "No description provided."}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() =>
                            editing &&
                            run(
                              () =>
                                addProject({
                                  collectionId: editing,
                                  repoId: item.repoId,
                                }),
                              "Could not add the project.",
                            )
                          }
                        >
                          Add
                        </Button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

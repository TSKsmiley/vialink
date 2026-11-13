// SPDX-License-Identifier: GPL-2.0-or-later
// Left sidebar of the editor (design board 1): the sections of the connected
// keyboard with how many entries each has set up. A vertical tablist, since
// each item switches the view beside it; on phones it becomes a scrolling row.

export interface Section {
  id: string;
  title: string;
  group: "edit" | "tools";
  count?: number | null;
}

interface Props {
  sections: readonly Section[];
  current: string;
  onSelect: (id: string) => void;
}

const GROUPS = [
  { id: "edit", label: "Edit" },
  { id: "tools", label: "Tools" },
] as const;

export function Sidebar({ sections, current, onSelect }: Props) {
  return (
    <nav
      aria-label="Sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-kumo-line p-2 md:w-56 md:flex-col md:overflow-x-visible md:border-r md:px-3 md:py-4 max-md:border-b"
    >
      {GROUPS.map((g) => {
        const items = sections.filter((s) => s.group === g.id);
        if (items.length === 0) return null;
        return (
          <div key={g.id} className="flex gap-1 md:flex-col md:pb-3">
            <span className="hidden px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-kumo-subtle uppercase md:block">
              {g.label}
            </span>
            <div
              role="tablist"
              aria-orientation="vertical"
              aria-label={g.label}
              className="flex gap-1 md:flex-col"
            >
              {items.map((s) => {
                const active = s.id === current;
                return (
                  <button
                    key={s.id}
                    data-anchor={`sidebar.${s.id}`}
                    role="tab"
                    aria-selected={active}
                    aria-description={s.count ? `${s.count} set up` : undefined}
                    onClick={() => onSelect(s.id)}
                    className={
                      "flex min-h-9 shrink-0 cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left whitespace-nowrap " +
                      (active
                        ? "bg-accent-tint font-semibold text-kumo-default"
                        : "text-kumo-default hover:bg-kumo-tint")
                    }
                  >
                    {s.title}
                    {s.count ? (
                      <span
                        aria-hidden="true"
                        className={
                          "text-xs " + (active ? "font-medium text-accent-link" : "text-kumo-subtle")
                        }
                      >
                        {s.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

import type { ChapterIdentity } from "@/types/domain";

/** Preserves the approved display pattern: "Name (Key)" + "District - Region". */
export function ChapterIdentityCard({
  identity,
}: {
  identity: ChapterIdentity;
}) {
  return (
    <div className="rounded-xl border-l-4 border-chapman-gold bg-[#fffaf0] px-4 py-3 text-sm">
      <div>
        <span className="font-bold">Name:</span> {identity.chapterName} (
        {identity.chapterKey})
      </div>
      <div>
        <span className="font-bold">District/Region:</span>{" "}
        {identity.district} - {identity.region}
      </div>
    </div>
  );
}

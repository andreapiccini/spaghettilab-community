import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useLocale } from "../../state/locale-context.js";
import { ProjectPicker } from "../project-picker/ProjectPicker.js";
import { CommunityScreen } from "./CommunityScreen.js";

export function StartScreen() {
  const [projects, setProjects] = useState(false);
  const { locale } = useLocale();
  return projects ? (
    <div className="flex h-dvh flex-col">
      <div className="border-b border-border bg-surface px-6 py-2">
        <button
          onClick={() => setProjects(false)}
          className="flex items-center gap-2 text-xs text-brand-blue"
        >
          <ArrowLeft size={13} />
          {locale === "it" ? "Torna alla community" : "Back to the community"}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ProjectPicker />
      </div>
    </div>
  ) : (
    <div className="h-dvh overflow-auto">
      <CommunityScreen onOpenProjects={() => setProjects(true)} />
    </div>
  );
}

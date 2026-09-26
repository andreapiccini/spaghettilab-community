import { useEffect, useState } from "react";
import { AppShell } from "./components/shell/AppShell.js";
import { ScreenStub } from "./components/shell/ScreenStub.js";
import { ProjectPicker } from "./components/project-picker/ProjectPicker.js";
import { CoreConnectionsScreen } from "./components/core-connections/CoreConnectionsScreen.js";
import { CatalogTopologyScreen } from "./components/catalog-topology/CatalogTopologyScreen.js";
import { PhysicalCompositionScreen } from "./components/physical-composition/PhysicalCompositionScreen.js";
import { DeviceProfileStudioScreen } from "./components/device-profile-studio/DeviceProfileStudioScreen.js";
import { ProcessingGraphScreen } from "./components/processing-graph/ProcessingGraphScreen.js";
import { DeployDiffScreen } from "./components/deploy-diff/DeployDiffScreen.js";
import { RuntimeDiagnosticsScreen } from "./components/runtime-diagnostics/RuntimeDiagnosticsScreen.js";
import { CapabilityMarketplaceScreen } from "./components/capability-marketplace/CapabilityMarketplaceScreen.js";
import { CrossCoreAutomationScreen } from "./components/cross-core-automation/CrossCoreAutomationScreen.js";
import { SettingsSecurityScreen } from "./components/settings-security/SettingsSecurityScreen.js";
import { MarketScreen } from "./components/coming-soon/MarketScreen.js";
import { SchematicPcbScreen } from "./components/coming-soon/SchematicPcbScreen.js";
import { EducationScreen } from "./components/coming-soon/EducationScreen.js";
import { DatasheetsScreen } from "./components/coming-soon/DatasheetsScreen.js";
import { SettingsModal } from "./components/settings-modal/SettingsModal.js";
import { NextStepHint } from "./components/shell/NextStepHint.js";
import { TourOverlay } from "./components/shell/TourOverlay.js";
import { isDemoOnlyEnabled, isScreenAllowedInDemo } from "./lib/demo-only.js";
import { prepareDemoProject } from "./lib/open-demo.js";
import { publicAsset } from "./lib/public-asset.js";
import { isScreenVisibleInMode } from "./lib/ui-mode.js";
import { CoreSessionsProvider } from "./state/core-sessions-context.js";
import { LocaleProvider } from "./state/locale-context.js";
import { NodeRedRuntimeProvider } from "./state/node-red-runtime-context.js";
import { PortProtocolProvider } from "./state/port-protocol-context.js";
import { SessionProvider, useSession } from "./state/session-context.js";
import { SettingsModalProvider } from "./state/settings-modal-context.js";
import { TourProvider } from "./state/tour-context.js";
import { UiModeProvider, useUiMode } from "./state/ui-mode-context.js";
import { productionExtensions } from "./extensions/registry.js";

const SCREEN_TITLES: Record<string, { readonly title: string; readonly task: string }> =
  {
    "runtime-diagnostics": { title: "Runtime & Diagnostics", task: "UI-S090" },
    "capability-marketplace": {
      title: "Capability Marketplace & OTA",
      task: "UI-S100",
    },
    "cross-core-automation": { title: "Cross-Core Automation", task: "UI-S110" },
    "settings-security": { title: "Sicurezza e recupero", task: "UI-S120" },
  };

function useDemoOnlyBootstrap() {
  const { session, openProject } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(() => isDemoOnlyEnabled());

  useEffect(() => {
    if (!isDemoOnlyEnabled()) return;
    let cancelled = false;
    void (async () => {
      const result = await prepareDemoProject();
      if (cancelled) return;
      if (!result.ok) {
        setError(result.kind === "build" ? "Could not create the demo project." : `Could not create the demo project: ${result.detail}`);
        setBooting(false);
        return;
      }
      openProject(result.project.projectId, result.project, { screen: "processing-graph" });
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [openProject]);

  return { error, booting, session };
}

function DemoBootScreen({ error }: { readonly error?: string | null }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-surface">
      <img src={publicAsset("ux-assets/logo-full.png")} alt="Spaghetti LAB" className="h-8" />
      <p className="font-body text-sm text-ink-muted">{error ?? "Opening the Processing Graph demo…"}</p>
    </div>
  );
}

function AppContent() {
  const { session, activeScreen, navigate } = useSession();
  const { mode } = useUiMode();
  const demoOnly = isDemoOnlyEnabled();
  const { error: demoError, booting: demoBooting } = useDemoOnlyBootstrap();

  useEffect(() => {
    if (demoOnly) {
      if (session && !isScreenAllowedInDemo(activeScreen)) navigate("processing-graph");
      return;
    }
    if (!isScreenVisibleInMode(activeScreen, mode)) {
      navigate("core-connections");
    }
  }, [activeScreen, mode, navigate, demoOnly, session]);

  if (demoOnly && (demoBooting || demoError || !session)) {
    return <DemoBootScreen error={demoError} />;
  }

  if (!session) return <ProjectPicker />;

  if (activeScreen === "core-connections") {
    return (
      <AppShell>
        <CoreConnectionsScreen />
      </AppShell>
    );
  }

  if (activeScreen === "catalog-topology") {
    return (
      <AppShell>
        <CatalogTopologyScreen />
      </AppShell>
    );
  }

  if (activeScreen === "physical-composition") {
    return (
      <AppShell>
        <PhysicalCompositionScreen />
      </AppShell>
    );
  }

  if (activeScreen === "device-profile-studio") {
    return (
      <AppShell>
        <DeviceProfileStudioScreen />
      </AppShell>
    );
  }

  if (activeScreen === "processing-graph") {
    return (
      <AppShell>
        <ProcessingGraphScreen />
      </AppShell>
    );
  }

  if (activeScreen === "deploy-diff") {
    return (
      <AppShell>
        <DeployDiffScreen />
      </AppShell>
    );
  }

  if (activeScreen === "runtime-diagnostics") {
    return (
      <AppShell>
        <RuntimeDiagnosticsScreen />
      </AppShell>
    );
  }

  if (activeScreen === "capability-marketplace") {
    return (
      <AppShell>
        <CapabilityMarketplaceScreen />
      </AppShell>
    );
  }

  if (activeScreen === "cross-core-automation") {
    return (
      <AppShell>
        <CrossCoreAutomationScreen />
      </AppShell>
    );
  }

  if (activeScreen === "settings-security") {
    return (
      <AppShell>
        <SettingsSecurityScreen />
      </AppShell>
    );
  }

  if (activeScreen === "market") {
    return (
      <AppShell>
        <MarketScreen />
      </AppShell>
    );
  }

  if (activeScreen === "generate-schematic-pcb") {
    return (
      <AppShell>
        <SchematicPcbScreen />
      </AppShell>
    );
  }

  if (activeScreen === "education") {
    return (
      <AppShell>
        <EducationScreen />
      </AppShell>
    );
  }

  if (activeScreen === "datasheets") {
    return (
      <AppShell>
        <DatasheetsScreen />
      </AppShell>
    );
  }

  const extensionScreen = productionExtensions
    .screens()
    .find(({ id }) => id === activeScreen);
  if (extensionScreen) {
    const ExtensionScreen = extensionScreen.component;
    return (
      <AppShell>
        <ExtensionScreen />
      </AppShell>
    );
  }

  const stub = SCREEN_TITLES[activeScreen];
  return (
    <AppShell>
      {stub ? (
        <ScreenStub title={stub.title} task={stub.task} />
      ) : (
        <ScreenStub title={activeScreen} task="?" />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <UiModeProvider>
      <LocaleProvider>
        <SettingsModalProvider>
          <NodeRedRuntimeProvider>
            <SessionProvider>
              <PortProtocolProvider>
                <TourProvider>
                  <CoreSessionsProvider>
                    <AppContent />
                    {!isDemoOnlyEnabled() && <SettingsModal />}
                    {!isDemoOnlyEnabled() && <TourOverlay />}
                    {!isDemoOnlyEnabled() && <NextStepHint />}
                  </CoreSessionsProvider>
                </TourProvider>
              </PortProtocolProvider>
            </SessionProvider>
          </NodeRedRuntimeProvider>
        </SettingsModalProvider>
      </LocaleProvider>
    </UiModeProvider>
  );
}

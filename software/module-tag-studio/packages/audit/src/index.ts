export type ProgrammingReport = {
  timestamp: string;
  operator: string;
  reader: string;
  antenna: 1 | 2;
  uid: string;
  productCode: string;
  moduleInstanceId: string;
  serialNumber: string;
  definitionKey: string;
  definitionHash: string;
  factoryCrc: string;
  installationCrc: string;
  verifyOk: boolean;
  lockState: string;
  errors: string[];
  retries: number;
};

export type JobDocument = {
  version: 1;
  mode: "guided" | "advanced" | "batch";
  operator: string;
  fields: Record<string, unknown>;
  definitionKey?: string;
};

export class AuditStore {
  private reports: ProgrammingReport[] = [];
  private logs: string[] = [];

  appendLog(event: string, fields: Record<string, unknown> = {}): void {
    // Never accept secrets
    const safe = { ...fields };
    delete safe.privateKey;
    delete safe.credentials;
    delete safe.password;
    this.logs.push(JSON.stringify({ event, timestamp: new Date().toISOString(), ...safe }));
  }

  addReport(report: ProgrammingReport): void {
    this.reports.push(report);
  }

  listReports(): readonly ProgrammingReport[] {
    return this.reports;
  }

  exportNdjson(): string {
    return this.logs.join("\n") + (this.logs.length ? "\n" : "");
  }

  exportReportsJson(): string {
    return JSON.stringify(this.reports, null, 2);
  }

  exportReportsCsv(): string {
    const header = [
      "timestamp",
      "operator",
      "reader",
      "antenna",
      "uid",
      "productCode",
      "moduleInstanceId",
      "serialNumber",
      "definitionKey",
      "definitionHash",
      "factoryCrc",
      "installationCrc",
      "verifyOk",
      "lockState",
      "errors",
      "retries",
    ];
    const rows = this.reports.map((r) =>
      [
        r.timestamp,
        r.operator,
        r.reader,
        r.antenna,
        r.uid,
        r.productCode,
        r.moduleInstanceId,
        r.serialNumber,
        r.definitionKey,
        r.definitionHash,
        r.factoryCrc,
        r.installationCrc,
        r.verifyOk,
        r.lockState,
        r.errors.join("|"),
        r.retries,
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    );
    return [header.join(","), ...rows].join("\n");
  }

  exportReportHtml(report: ProgrammingReport): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Tag Studio Report</title></head><body>
<h1>Spaghetti LAB Module Tag Studio — Report</h1>
<ul>
<li>Timestamp: ${report.timestamp}</li>
<li>Operator: ${report.operator}</li>
<li>Reader: ${report.reader} / ANT${report.antenna}</li>
<li>UID: ${report.uid}</li>
<li>Product: ${report.productCode}</li>
<li>Instance: ${report.moduleInstanceId}</li>
<li>Serial: ${report.serialNumber}</li>
<li>Definition: ${report.definitionKey}</li>
<li>Hash: ${report.definitionHash}</li>
<li>Factory CRC: ${report.factoryCrc}</li>
<li>Install CRC: ${report.installationCrc}</li>
<li>Verify: ${report.verifyOk ? "OK" : "FAIL"}</li>
<li>Locks: ${report.lockState}</li>
<li>Retries: ${report.retries}</li>
<li>Errors: ${report.errors.join("; ") || "none"}</li>
</ul>
</body></html>`;
  }
}

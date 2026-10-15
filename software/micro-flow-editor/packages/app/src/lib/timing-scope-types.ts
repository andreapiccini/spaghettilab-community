export type TimingLevel = 0 | 1;

export type TimingEdge = {
  readonly t: number;
  readonly level: TimingLevel;
};

export type TimingSpanAnnotation = {
  readonly t0: number;
  readonly t1: number;
  readonly label: string;
};

export type TimingPhaseBand = {
  readonly editableByte?: {
    readonly index: number;
    readonly value: string;
    readonly last: boolean;
  };
  readonly id: string;
  readonly t0: number;
  readonly t1: number;
  readonly label: string;
  readonly opId?: string;
  readonly color?: string;
};

/** Recipe step aligned to the same time axis as phase bands / lanes. */
export type TimingStepSpan = {
  readonly opId: string;
  readonly index: number;
  readonly label: string;
  readonly t0: number;
  readonly t1: number;
  readonly kind: "bus" | "data";
};

export type TimingLane = {
  readonly id: string;
  readonly label: string;
  readonly edges: readonly TimingEdge[];
  readonly sampleTimes?: readonly number[];
  readonly annotation?: TimingSpanAnnotation;
  /** Trace stroke — keep distinct when several lanes share the plot. */
  readonly color?: string;
};

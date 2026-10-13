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
  readonly id: string;
  readonly t0: number;
  readonly t1: number;
  readonly label: string;
  readonly opId?: string;
  readonly color?: string;
};

export type TimingLane = {
  readonly id: string;
  readonly label: string;
  readonly edges: readonly TimingEdge[];
  readonly sampleTimes?: readonly number[];
  readonly annotation?: TimingSpanAnnotation;
};

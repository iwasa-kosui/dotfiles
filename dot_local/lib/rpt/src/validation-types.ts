export type Point = Readonly<{
  line: number;
  column: number;
  offset?: number;
}>;

export type Positioned = Readonly<{
  position?: Readonly<{ start: Point; end: Point }>;
}>;

export type Attribute = Positioned &
  Readonly<{
    type: string;
    name?: string;
    value?: string | Positioned | null;
  }>;

export type TreeNode = Positioned &
  Readonly<{
    type: string;
    value?: string;
    name?: string | null;
    url?: string;
    alt?: string | null;
    depth?: number;
    identifier?: string;
    attributes?: readonly Attribute[];
    children?: readonly TreeNode[];
  }>;

export type ValidationIssue = Readonly<{
  message: string;
  node?: Positioned;
}>;

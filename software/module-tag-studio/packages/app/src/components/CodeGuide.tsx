export function CodeGuide({
  title,
  rows,
}: {
  title: string;
  rows: { code: string; label: string }[];
}) {
  return (
    <div className="code-guide">
      <div className="code-guide-title">{title}</div>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td className="mono">{r.code}</td>
              <td>{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

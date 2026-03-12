import type { ReactNode } from "react";

type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
};

export function DataTable<T>({ columns, rows, rowKey, emptyMessage = "Sem dados." }: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-700/70 text-slate-400">
            {columns.map((column) => (
              <th key={column.key} className={`py-2 font-medium ${column.className ?? ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={columns.length} className="py-4 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-slate-800/70 text-slate-200">
              {columns.map((column) => (
                <td key={column.key} className={`py-2 align-top ${column.className ?? ""}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

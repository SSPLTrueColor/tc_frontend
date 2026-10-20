import { type TableHTMLAttributes } from 'react';
import { cx } from '../../lib/format';

/**
 * Plain table in the template style, with horizontal scroll contained inside it. Use it for short static tables
 * (key facts, matrices). Sorting / paging / states: DataTable. Resource lists: DataGrid.
 * Write the usual <thead>/<tbody>/<tr>/<th scope>/<td> inside; number cells get className="num".
 */
export function Table({ className, children, scroll = true, ...rest }: TableHTMLAttributes<HTMLTableElement> & { scroll?: boolean }) {
  const table = (
    <table className={cx('mini-table', className)} {...rest}>
      {children}
    </table>
  );
  return scroll ? <div className="table-scroll">{table}</div> : table;
}

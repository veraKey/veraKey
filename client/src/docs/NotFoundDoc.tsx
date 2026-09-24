import { Link } from "wouter";
import { pagesByGroup } from "./registry";

export function NotFoundDoc() {
  return (
    <div className="dx-notfound">
      <p className="dx-crumb">404</p>
      <h1>This page does not exist</h1>
      <p className="dx-lead">The link may be old or mistyped. Start from one of these instead:</p>
      <ul>
        {pagesByGroup().map(({ group, pages }) => (
          <li key={group}>
            <Link href={pages[0].path}>{group}: {pages[0].title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

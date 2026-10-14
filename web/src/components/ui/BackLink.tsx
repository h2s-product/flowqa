import { Link } from 'react-router-dom';

/** Tautan kembali ke halaman daftar, mis. "← Test runs". */
export const BackLink = ({ to, label }: { to: string; label: string }) => (
  <Link className="btn sm ghost" to={to}>
    ← {label}
  </Link>
);

import Link from "next/link";
import Image from "next/image";
import kemenkumLogo from "@/assets/kemenkum_logo.png";

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-kemenkum-blue flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-6">
          <Image src={kemenkumLogo} alt="Kemenkum" width={48} height={48} />
          <h1 className="text-2xl font-bold text-kemenkum-blue">Kemenkum Summarizer</h1>
        </div>
        <p className="text-gray-700 mb-6">Registrasi tidak tersedia.</p>
        <Link
          href="/login"
          className="inline-block text-kemenkum-blue font-medium hover:underline"
        >
          Kembali ke halaman masuk
        </Link>
      </div>
    </main>
  );
}

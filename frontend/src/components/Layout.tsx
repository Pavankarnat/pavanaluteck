import React from 'react';
import Navbar from './Navbar';
import Footer from './Footer';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen bg-cad-bg text-cad-textPrimary transition-colors duration-200">
      <Navbar />
      <main className="flex-grow flex flex-col">{children}</main>
      <Footer />
    </div>
  );
}

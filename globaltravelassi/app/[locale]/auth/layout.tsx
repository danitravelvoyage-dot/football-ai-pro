import type { ReactNode } from "react";
import { Container, Section } from "@/components/ui";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Section className="relative overflow-hidden py-14 sm:py-20">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-navy-950 to-transparent opacity-[0.07]" />
      <Container className="max-w-md">{children}</Container>
    </Section>
  );
}

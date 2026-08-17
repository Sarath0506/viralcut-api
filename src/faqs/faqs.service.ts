import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

function formatFaq(faq: {
  id: string;
  question: string;
  answer: string;
  order: number;
  isVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    order: faq.order,
    isVisible: faq.isVisible,
    createdAt: faq.createdAt.toISOString(),
    updatedAt: faq.updatedAt.toISOString(),
  };
}

@Injectable()
export class FaqsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll() {
    const faqs = await this.prisma.faq.findMany({ orderBy: { order: "asc" } });
    return faqs.map(formatFaq);
  }

  async listVisible() {
    const faqs = await this.prisma.faq.findMany({
      where: { isVisible: true },
      orderBy: { order: "asc" },
    });
    return faqs.map(formatFaq);
  }

  async create(dto: { question: string; answer: string; isVisible?: boolean }) {
    const last = await this.prisma.faq.findFirst({ orderBy: { order: "desc" } });
    const faq = await this.prisma.faq.create({
      data: {
        question: dto.question.trim(),
        answer: dto.answer.trim(),
        isVisible: dto.isVisible ?? true,
        order: (last?.order ?? -1) + 1,
      },
    });
    return formatFaq(faq);
  }

  async update(id: string, dto: { question?: string; answer?: string; isVisible?: boolean }) {
    const existing = await this.prisma.faq.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "FAQ not found" });
    }
    const faq = await this.prisma.faq.update({
      where: { id },
      data: {
        question: dto.question?.trim(),
        answer: dto.answer?.trim(),
        isVisible: dto.isVisible,
      },
    });
    return formatFaq(faq);
  }

  async remove(id: string) {
    await this.prisma.faq.delete({ where: { id } }).catch(() => {
      throw new NotFoundException({ code: "NOT_FOUND", message: "FAQ not found" });
    });
    return { deleted: true };
  }

  async reorder(orderedIds: string[]) {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.faq.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.listAll();
  }
}

import nodemailer from 'nodemailer';
import { ENV } from '../../../config/env';
import { AuditEmailData, Recommendation } from './email.types';
import { promises as fs } from 'fs';
import path from 'path';

const transporter = nodemailer.createTransport({
  host: ENV.EMAIL_HOST,
  port: ENV.EMAIL_PORT,
  secure: ENV.EMAIL_PORT === 465,
  auth: {
    user: ENV.EMAIL_USER,
    pass: ENV.EMAIL_PASS,
  },
});

export class EmailService {
  async sendAuditReport(to: string, data: AuditEmailData): Promise<void> {
    const html = await this.generateHtml(data);
    const modeLabel = (data.mode || 'full').toUpperCase();

    await transporter.sendMail({
      from: ENV.EMAIL_FROM,
      to,
      subject: `CRO Audit Report - ${data.url} (${modeLabel})`,
      html,
    });
  }

  private async generateHtml(data: AuditEmailData): Promise<string> {
    const templatePath = path.join(__dirname, 'templates', 'audit-report.html');
    let template = await fs.readFile(templatePath, 'utf-8');

    const modeLabel = (data.mode || 'full').toUpperCase();
    const scColor = this.getScoreColor(data.score);
    const ringOffset = 339.29 - (data.score / 100) * 339.29;

    template = template
      .replace(/{{url}}/g, data.url)
      .replace(/{{mode}}/g, modeLabel)
      .replace(/{{score}}/g, String(data.score))
      .replace(/{{grade}}/g, data.grade)
      .replace(/{{label}}/g, data.label)
      .replace(/{{scoreColor}}/g, scColor)
      .replace(/{{ringOffset}}/g, String(ringOffset))
      .replace(/{{message}}/g, data.message)
      .replace(/{{breakdownRows}}/g, this.generateBreakdownRows(data.breakdown))
      .replace(/{{metricsGrid}}/g, this.generateMetricsGrid(data.metrics))
      .replace(/{{quickWins}}/g, this.generateQuickWins(data.recommendations || []))
      .replace(/{{recommendationsGrid}}/g, this.generateRecommendations(data.recommendations || []))
      .replace(/{{criticalIssueCount}}/g, String(data.criticalIssueCount))
      .replace(
        /{{timestamp}}/g,
        new Date(data.timestamp).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      );

    return template;
  }

  private getScoreColor(score: number): string {
    if (score >= 85) return '#1BA43A';
    if (score >= 70) return '#007AA2';
    if (score >= 55) return '#F59E0B';
    return '#D41638';
  }

  private generateBreakdownRows(breakdown: unknown): string {
    if (!breakdown || typeof breakdown !== 'object') {
      return '<div style="color: #939698; font-style: italic; font-size: 13px;">No breakdown data available.</div>';
    }

    const entries = Object.entries(breakdown as Record<string, unknown>);
    return entries
      .map(([key, value]) => {
        let score = 0;
        if (typeof value === 'number') {
          score = value;
        } else if (value && typeof value === 'object') {
          const obj = value as { score?: number };
          score = obj.score ?? 0;
        }

        const barColor = this.getScoreColor(score);
        const displayKey = key
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (c) => c.toUpperCase())
          .trim();

        return `
          <div class="breakdown-row">
            <div class="breakdown-meta">
              <span class="breakdown-label">${displayKey}</span>
              <span class="breakdown-score" style="color: ${barColor}">${score}%</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${score}%; background-color: ${barColor};"></div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private generateMetricsGrid(metrics?: Record<string, string | number>): string {
    if (!metrics || Object.keys(metrics).length === 0) {
      return '<div style="color: #939698; font-style: italic; font-size: 13px;">No key metrics available.</div>';
    }

    const entries = Object.entries(metrics).slice(0, 3); // Take top 3 for the email grid
    let gridHtml = '<div class="metrics-grid">';

    entries.forEach(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .trim();

      let color = '#122932';
      if (typeof value === 'string') {
        if (value.includes('Optimized')) color = '#1BA43A';
        else if (value.includes('At Risk')) color = '#D41638';
        else if (value.includes('Average')) color = '#F59E0B';
      }

      gridHtml += `
        <div class="metric-card">
          <div class="metric-label">${label}</div>
          <div class="metric-value" style="color: ${color}">${value}</div>
        </div>
      `;
    });

    gridHtml += '</div>';
    return gridHtml;
  }

  private generateQuickWins(recommendations: Recommendation[]): string {
    const highImpact = recommendations.filter((r) => r.impact === 'High');

    if (!highImpact.length) {
      return '<p style="color: #6b7280; font-style: italic;">No critical issues detected — great job!</p>';
    }

    return highImpact
      .map((rec) => {
        const fix = rec.businessValue || rec.recommendation;
        return `
          <div class="issue-card issue-crit" style="margin-bottom: 2px; border-bottom-left-radius: 0; border-bottom-right-radius: 0;">
            <div class="issue-dot" style="background-color: #d41638"></div>
            <span style="font-weight: 600; font-size: 13px;">${rec.issue}</span>
          </div>
          <div class="issue-card issue-win" style="margin-bottom: 25px; border-top-left-radius: 0; border-top-right-radius: 0;">
            <div class="issue-dot" style="background-color: #1ba43a"></div>
            <span style="font-weight: 600; font-size: 13px;">${fix}</span>
          </div>
        `;
      })
      .join('');
  }

  private generateRecommendations(recommendations: Recommendation[]): string {
    if (!recommendations || !recommendations.length) {
      return '<p style="color: #6b7280; font-style: italic;">No recommendations available.</p>';
    }

    return recommendations
      .map((rec) => {
        const impactClass = (rec.impact || 'medium').toLowerCase();
        const fix = rec.businessValue;
        const displayCategory = String(rec.category)
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase())
          .trim();

        return `
          <div class="rec-card">
            <div class="rec-header">
              <span class="cat-tag">${displayCategory}</span>
              <span class="impact-badge ${impactClass}">Impact: ${rec.impact}</span>
            </div>
            <h4 class="rec-title">${rec.issue}</h4>
            <p class="rec-desc">${rec.recommendation}</p>
            ${fix ? `<div class="rec-tip">💡 ${fix}</div>` : ''}
          </div>
        `;
      })
      .join('');
  }
}

export const emailService = new EmailService();

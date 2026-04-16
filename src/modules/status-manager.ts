import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { logger } from '../logger.ts';

interface StrategyStatus {
  active: boolean;
}

type StatusMap = Record<string, StrategyStatus>;

export class StrategyStatusManager {
  private statusMap: StatusMap = {};
  private readonly configPath = 'config/strategies.json';

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8');
        this.statusMap = JSON.parse(data);
        logger.debug(`[StatusManager] Carregados status de ${Object.keys(this.statusMap).length} estratégias.`);
      }
    } catch (err) {
      logger.error(`[StatusManager] Erro ao carregar status: ${err}`);
      this.statusMap = {};
    }
  }

  private save(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.statusMap, null, 2));
    } catch (err) {
      logger.error(`[StatusManager] Erro ao salvar status: ${err}`);
    }
  }

  // Garante que a estratégia apareça no dashboard mesmo sem ter sido toggleada
  ensure(strategyId: string): void {
    if (!(strategyId in this.statusMap)) {
      this.statusMap[strategyId] = { active: true };
      this.save();
    }
  }

  isActive(strategyId: string): boolean {
    // Por padrão, se não estiver no mapa, consideramos ativa
    return this.statusMap[strategyId]?.active !== false;
  }

  toggle(strategyId: string, active: boolean): void {
    this.statusMap[strategyId] = { active };
    this.save();
    logger.log(`[StatusManager] Estratégia ${strategyId} agora está ${active ? 'ATIVA' : 'INATIVA'}`);
  }

  getAllStatus(): StatusMap {
    return { ...this.statusMap };
  }
}

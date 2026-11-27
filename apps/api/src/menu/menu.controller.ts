import { Controller, Get, Req, Res } from '@nestjs/common';
import type { MenuDto } from '@kikko/shared';
import type { Request, Response } from 'express';
import { Pubblico } from '../auth/decorators.js';
import { MenuService } from './menu.service.js';

@Controller('menu')
@Pubblico()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  /** The menu changes rarely: clients revalidate with ETag and get 304 when nothing changed. */
  @Get()
  async menuCliente(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MenuDto | undefined> {
    const menu = await this.menu.menuCliente();
    const etag = `"${menu.versione}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return undefined;
    }
    return menu;
  }
}

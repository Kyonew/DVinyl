import { Router } from 'express';
import { registry } from '../../../core/registry';
import { requireApiAuth } from '../../../middleware/authMiddleware';

const router = Router();

router.get('/plugins', requireApiAuth, async (req: any, res: any) => {
  const plugins = registry.getAll().map(p => ({
    id: p.id,
    kind: p.kind,
    label: p.label,
    icon: p.icon,
    routePrefix: p.routePrefix,
    collectionType: p.collectionType,
    formFields: p.formFields.map(f => ({
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required || false,
      options: f.options,
      default: f.default,
      showIn: f.showIn,
      group: f.group,
      placeholder: f.placeholder,
      hint: f.hint
    })),
    formats: p.formats,
    creatorField: p.creatorField,
    externalIdField: p.externalIdField,
    externalIdLabel: p.externalIdLabel,
    externalIdHint: p.externalIdHint,
    supportsBarcodeSearch: p.supportsBarcodeSearch || false,
    supportsPriceEstimate: p.supportsPriceEstimate || false
  }));

  res.status(200).json({ plugins });
});

export = router;

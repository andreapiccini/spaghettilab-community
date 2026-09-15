<p align="center">
  <img src="spaghetti-logo-blu.png" width="500" alt="SpaghettiLAB">
</p>

<p align="center">
  <a href="https://spaghetti-lab.my.canva.site/">Website</a> •
  <a href="https://spaghetti-lab.my.canva.site/join-newsletter">Newsletter</a>
</p>

# SpaghettiLAB Community

From prototype to product.

SpaghettiLAB Community is the open development platform for learning,
experimenting, and building modular embedded and IoT prototypes. It includes
reference hardware, firmware, local software, protocols, integrations, tests,
and examples without artificial feature restrictions.

A prototype is not automatically suitable for production. Professional
deployments also require qualified hardware, secure provisioning, verified
updates, release traceability, lifecycle maintenance, and accountable support.
Those production capabilities are developed and delivered separately so that
organizations can adopt SpaghettiLAB without weakening the open Community
platform.

## Repository structure

- `hardware/` — Core, Backbone, and Module reference designs.
- `firmware/` — Community firmware, SDKs, examples, and verification.
- `software/` — Local Studio, dashboard, Node-RED integration, and packages.
- `contracts/` — Public, language-neutral protocol contracts and golden fixtures.
- `examples/` — End-to-end example systems.
- `docs/` — Documentation licensing and notices.

The Community hardware tree intentionally contains editable KiCad sources, not
generated manufacturing packages. Official production files, factory tooling,
secure provisioning infrastructure, managed cloud services, and commercial
support are maintained separately.

## Open-core model

SpaghettiLAB follows an open-core hardware model with a clear boundary:

- **Community layer:** the source files actually published in this repository,
  licensed under the open-source and open-hardware licences listed below. These
  licences permit commercial use when their conditions are followed.
- **Production layer:** the separately maintained, release-specific package used
  for official commercial products and authorized manufacturing partners.

The Production layer is not part of this repository. It may include validated
Gerber and drill outputs, approved BOM and alternate-part data, pick-and-place
files, panelization and assembly profiles, test fixtures and procedures,
production firmware or provisioning material, enclosure and packaging files,
quality-control criteria, release traceability, and supplier-specific data.
Access to those materials, use of official SpaghettiLAB branding, and the right
to present a product as official or partner-produced require prior written
authorization under a separate commercial or manufacturing agreement.

Anyone may generate their own manufacturing outputs from the public hardware
sources and make or sell products as permitted by CERN-OHL-S-2.0. Such products
must comply with that licence and must not imply official manufacture,
certification, warranty, endorsement, or partnership. See
[`COMMERCIAL.md`](COMMERCIAL.md) and [`TRADEMARK.md`](TRADEMARK.md).

## Hardware projects

- `hardware/core/core.kicad_pro`
- `hardware/backbone/backbone.kicad_pro`
- `hardware/modules/nfc-tag/nfc-tag.kicad_pro`

The KiCad source files embed the symbols and footprints already used by each
design. Some optional 3D models reference the `SPAGHETTI_LIB` environment
variable and are not required to open the schematic or PCB.

## Community and production

The Community platform is intended for education, research, development,
prototyping, and open products. Organizations may evaluate and extend it under
the applicable open-source and open-hardware licenses.

SpaghettiLAB Production adds the controlled engineering work needed to turn a
prototype into a supported product: qualified hardware, secure device identity,
signed releases, manufacturing support, managed updates, fleet operations, and
long-term maintenance.

## Citation

If you use SpaghettiLAB in research, publications, articles, videos, educational
material, or derivative projects, please cite:

> Piccini, A. (2026).  
> SpaghettiLAB: Modular Stackable Electronics Platform.  
> GitHub Repository.  
> https://github.com/andreapiccini/SpaghettiLAB

A machine-readable citation file is available in `CITATION.cff`.

## Licensing

The current Community generation retains the licenses already applied to its
components:

| Content | License |
|---|---|
| Firmware | GPL-3.0-or-later |
| Public applications and services | AGPL-3.0-or-later |
| Protocols and selected integration SDKs | Apache License 2.0 |
| Hardware reference designs | CERN-OHL-S-2.0 |
| Documentation | CC BY 4.0 |

See [`LICENSES.md`](LICENSES.md) for the exact repository map,
[`CONTRIBUTING.md`](CONTRIBUTING.md) for DCO contribution requirements, and
[`TRADEMARK.md`](TRADEMARK.md) for product identity rules. The copyleft transition
does not alter rights granted for earlier versions.

#70x66mm UI revision

- Header columns4.00mm, row pitch2.54mm, inner DIP span7.62mm. Hanxia nominal plastic body2.54mm wide; nominal terminal-to-neighbour-body gap about0.28mm using LS4.9mm. Original pads and terminal staggering retained. Courtyard overlaps remain; bottom insertion and assembly need real samples.
- LED rows2.54mm and columns2.85mm at45degrees retained. Further pitch reduction would reduce existing minimum copper clearance; no courtyard shrinking or error suppression used. LED nominal neighbour gap remains about0.196mm, tolerance stack not qualified.
-16MCU icons,3pins per side,0.14mm strokes; all icon endpoints plus stroke fit within each rotated1.85mm copper exclusion. FR4 transmission/contrast and light bleed require an optical sample.
- XKB drawing: pads1.00x0.75mm, centresX±3.00/Y±1.875mm; top pairA/B shorted internally, bottom pairC/D shorted internally. Footprint uses duplicate pad numbers1(top) and2(bottom). Button physical3D is a local dimensional approximation.
-100nF C400 and bulk1uF C401 remain together beside U70. The Qwiic pullup R24 is relocated near the north edge to clear that area. Optimize final routes together with power distribution. Whole PCB remains unrouted (499unconnecteditems), not fabrication-ready.
- SW1 GPIO21/modulepad23 active low; SW2 GPIO13/modulepad21 active low, shared with J25.7. Internal pullups and debouncing required in firmware, which has not been implemented. No changes to the GPIO0/ESP_EN expander reset interlock.

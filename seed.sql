-- Closed-alpha catalogue. Confirm every external store identity before public launch.
insert into public.vendors(id,slug,business_name,description,short_description,mark,accent,commission_rate_bps,status,is_platform_owned,featured_override,sales_count)
values
('10000000-0000-4000-8000-000000000001','barax','BARAX','A fearless independent label translating Limpopo street energy into limited garments built to be seen.','Street statements from Limpopo','BX','sand',1000,'active',false,null,184),
('10000000-0000-4000-8000-000000000002','kaychero-w','KAYCHERO W','Sound, motion and fearless style expressed through heavyweight essentials and short-run drops.','Sound, motion and fearless style','KW','mist',1000,'active',false,null,162),
('10000000-0000-4000-8000-000000000003','le-26','LE 26','Small releases, distinctive graphics and pieces carrying the pulse of a growing movement.','Limited pieces. Loud identity.','26','stone',1000,'active',false,null,141),
('10000000-0000-4000-8000-000000000004','kompo-nation','Kompo Nation','The house collection: clean essentials designed to carry the nation everywhere it goes.','The house collection','KN','sage',1000,'active',true,true,119),
('10000000-0000-4000-8000-000000000005','northern-static','Northern Static','Experimental streetwear made for loud rooms, night drives and northern summers.','Experimental northern streetwear','NS','mist',1000,'active',false,null,76),
('10000000-0000-4000-8000-000000000006','moya-form','Moya Form','Relaxed garments shaped by rhythm, movement and everyday life in Limpopo.','Made to move with you','MF','sand',1000,'active',false,null,58)
on conflict (id) do update set business_name=excluded.business_name, description=excluded.description, short_description=excluded.short_description, mark=excluded.mark, accent=excluded.accent;

insert into public.vendor_private_settings(vendor_id,contact_email,collection_city,collection_province,collection_postal_code)
values
('10000000-0000-4000-8000-000000000001','store+barax@komponation.co.za','Polokwane','Limpopo','0700'),
('10000000-0000-4000-8000-000000000002','store+kaychero@komponation.co.za','Polokwane','Limpopo','0700'),
('10000000-0000-4000-8000-000000000003','store+le26@komponation.co.za','Polokwane','Limpopo','0700'),
('10000000-0000-4000-8000-000000000004','store@komponation.co.za','Polokwane','Limpopo','0700'),
('10000000-0000-4000-8000-000000000005','store+northern@komponation.co.za','Polokwane','Limpopo','0700'),
('10000000-0000-4000-8000-000000000006','store+moya@komponation.co.za','Polokwane','Limpopo','0700')
on conflict (vendor_id) do update set contact_email=excluded.contact_email,collection_city=excluded.collection_city,collection_province=excluded.collection_province,collection_postal_code=excluded.collection_postal_code;

insert into public.products(id,vendor_id,slug,name,description,category,tone,is_rare,status,sales_count)
values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','night-signal-tee','Night Signal Tee','A structured heavyweight cotton tee with an original signal graphic and relaxed unisex fit.','T-shirts','sage',false,'active',96),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','movement-heavyweight','Movement Heavyweight','Dense premium cotton, a boxy silhouette and a clean front mark built for daily rotation.','T-shirts','sand',true,'active',121),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','northern-pulse-cap','Northern Pulse Cap','A six-panel cap with embroidered pulse detail, adjustable back and curved brim.','Accessories','mist',true,'active',88),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','after-dark-hoodie','After Dark Hoodie','Warm brushed fleece, deep hood and minimal chest artwork for late nights and early sets.','Hoodies','stone',false,'active',104),
('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','barax-line-jacket','Line Jacket','A lightweight black layer with contrast piping and a compact fold-away hood.','Jackets','mist',true,'active',74),
('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','nation-crest-sweat','Nation Crest Sweat','A soft crewneck with tonal crest embroidery and a generous relaxed cut.','Sweatshirts','sand',false,'active',67),
('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000005','static-cargo','Static Cargo','Straight-leg utility trousers with articulated knees and secure side pockets.','Bottoms','sage',false,'active',43),
('20000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000006','moya-canvas-tote','Moya Canvas Tote','A reinforced cotton carry-all with long handles and a subtle woven label.','Accessories','sand',false,'active',39),
('20000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000004','nation-vinyl-sticker','Nation Vinyl Sticker','A durable weather-resistant Kompo Nation vinyl sticker for the first physical checkout run.','Accessories','mist',false,'active',0)
on conflict (id) do update set name=excluded.name,description=excluded.description,category=excluded.category,tone=excluded.tone,is_rare=excluded.is_rare,status=excluded.status;

insert into public.product_variants(product_id,sku,size,colour,price_cents,stock_quantity,weight_kg,length_cm,width_cm,height_cm)
values
('20000000-0000-4000-8000-000000000001','KN-NST-M-BLK','M','Black',48000,28,.35,42,32,6),
('20000000-0000-4000-8000-000000000002','BX-MHV-M-BNE','M','Bone',76000,16,.38,42,32,6),
('20000000-0000-4000-8000-000000000003','LE-PUL-OS-BLK','One size','Black',34000,6,.22,24,20,14),
('20000000-0000-4000-8000-000000000004','KC-ADH-M-BLK','M','Black',92000,19,.75,48,38,12),
('20000000-0000-4000-8000-000000000005','BX-LJ-M-BLK','M','Black',118000,11,.62,48,38,10),
('20000000-0000-4000-8000-000000000006','KN-NCS-M-BNE','M','Bone',78000,32,.62,46,36,9),
('20000000-0000-4000-8000-000000000007','NS-SCG-32-CHR','32','Charcoal',89000,14,.68,45,35,9),
('20000000-0000-4000-8000-000000000008','MF-TOT-OS-NAT','One size','Natural',29000,44,.28,38,30,4),
('20000000-0000-4000-8000-000000000009','KN-STK-OS-STN','One size','Stone',1000,25,.02,12,9,1)
on conflict (sku) do update set price_cents=excluded.price_cents,stock_quantity=excluded.stock_quantity,weight_kg=excluded.weight_kg,length_cm=excluded.length_cm,width_cm=excluded.width_cm,height_cm=excluded.height_cm;

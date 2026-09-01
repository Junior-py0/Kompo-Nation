-- Closed-alpha catalogue. Confirm every external store identity before public launch.
insert into public.vendors(id,slug,business_name,description,short_description,mark,accent,commission_rate_bps,status,is_platform_owned,featured_override,sales_count)
values
('10000000-0000-4000-8000-000000000001','barax','BARAX','A fearless independent label translating Limpopo street energy into limited garments built to be seen.','Street statements from Limpopo','BX','sand',1000,'active',false,null,0),
('10000000-0000-4000-8000-000000000002','kaychero-w','KAYCHERO W','Sound, motion and fearless style expressed through heavyweight essentials and short-run drops.','Sound, motion and fearless style','KW','mist',1000,'active',false,null,0),
('10000000-0000-4000-8000-000000000003','le-26','LE 26','Small releases, distinctive graphics and pieces carrying the pulse of a growing movement.','Limited pieces. Loud identity.','26','stone',1000,'active',false,null,0),
('10000000-0000-4000-8000-000000000004','kompo-nation','Kompo Nation','The house collection: clean essentials designed to carry the nation everywhere it goes.','The house collection','KN','sage',1000,'active',true,true,0),
('10000000-0000-4000-8000-000000000005','northern-static','Northern Static','Experimental streetwear made for loud rooms, night drives and northern summers.','Experimental northern streetwear','NS','mist',1000,'active',false,null,0),
('10000000-0000-4000-8000-000000000006','moya-form','Moya Form','Relaxed garments shaped by rhythm, movement and everyday life in Limpopo.','Made to move with you','MF','sand',1000,'active',false,null,0)
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

-- Products and variants are intentionally not seeded. The production catalogue
-- starts empty and must be populated through the admin/vendor portal.

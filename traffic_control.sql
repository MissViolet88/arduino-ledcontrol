create table
    public.traffic_control (
        id serial not null,
        action text not null,
        active boolean null default true,
        created_at timestamp
        with
            time zone null default now (),
            constraint traffic_control_pkey primary key (id)
    ) TABLESPACE pg_default;
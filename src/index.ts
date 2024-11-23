import {
  Feature,
  GeoJsonProperties,
  Point,
  LineString,
  Polygon,
  Geometry,
} from "geojson";
import { DOMParser } from "xmldom";
import crypto from "crypto";
export interface KmlFolder {
  folder_id: string;
  name: string;
  parent_folder_id: string | null;
}

export interface KmlIconStyleProps {
  "icon-color"?: string;
  "icon-opacity"?: number;
  "icon-size"?: number;
  "icon-image"?: string;
  "text-color"?: string;
  "text-opacity"?: number;
  "text-size"?: number;
}

export interface KmlLineStyleProps {
  "line-color"?: string;
  "line-opacity"?: number;
  "line-width"?: number;
}

export interface KmlPolyStyleProps {
  "fill-color"?: string;
  "fill-opacity"?: number;
  "fill-outline-color"?: string;
}

export type KmlStyleProps =
  | KmlIconStyleProps
  | KmlLineStyleProps
  | KmlPolyStyleProps;

export type KmlPointFeature<P = GeoJsonProperties> = Omit<
  Feature<Point, P & KmlIconStyleProps>,
  "bbox"
>;

export type KmlLineFeature<P = GeoJsonProperties> = Omit<
  Feature<LineString, P & KmlLineStyleProps>,
  "bbox"
>;

export type KmlPolyFeature<P = GeoJsonProperties> = Omit<
  Feature<Polygon, P & KmlPolyStyleProps>,
  "bbox"
>;

export type KmlGeoCollFeature<P = GeoJsonProperties> = Omit<
  Feature<Geometry, P>,
  "bbox"
>;

export type KmlFeature<P = GeoJsonProperties> =
  | KmlPointFeature<P>
  | KmlLineFeature<P>
  | KmlPolyFeature<P>
  | KmlGeoCollFeature<P>;

export interface KmlGeojson<P = GeoJsonProperties> {
  type: "FeatureCollection";
  features: Array<KmlFeature<P>>;
}

export class KmlToGeojson {
  private include_altitude: boolean;

  constructor(altitude = true) {
    this.include_altitude = altitude;
  }

  private readonly get1 = (
    node: Element,
    tag_name: string,
    direct_child = false
  ): Element | null => {
    const nodes = node.getElementsByTagName(tag_name);
    if (direct_child) {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].parentNode === node) {
          return nodes[i];
        }
      }
      return null;
    }
    return nodes.length ? nodes[0] : null;
  };

  private readonly get = (
    node: Element,
    tag_name: string,
    direct_child = false
  ): Element[] => {
    const elements = [];
    const res = node.getElementsByTagName(tag_name);
    for (let i = 0; i < res.length; i++) {
      if (direct_child && res[i].parentNode !== node) continue;
      elements.push(res[i]);
    }
    return elements;
  };

  private readonly kmlColor = (v: any) => {
    let color, opacity: any;
    v = v || "";
    if (v.substr(0, 1) === "#") {
      v = v.substr(1);
    }
    if (v.length === 6 || v.length === 3) {
      color = v;
    }
    if (v.length === 8) {
      opacity = parseInt(v.substr(0, 2), 16) / 255;
      color = "#" + v.substr(6, 2) + v.substr(4, 2) + v.substr(2, 2);
    }
    return { color, opacity: isNaN(opacity) ? undefined : opacity };
  };

  private readonly parseCoordinate = (
    node: Element | string
  ): number[] | null => {
    const coordinate_text = typeof node === "string" ? node : node.textContent;
    if (!coordinate_text) return null;

    const split = coordinate_text.trim().split(",");
    const longitude = parseFloat(split[0]);
    const latitude = parseFloat(split[1]);
    const altitude = split.length > 2 ? parseFloat(split[2]) : 0;

    const arr = [longitude, latitude];
    if (this.include_altitude) arr.push(altitude);

    return arr;
  };

  private readonly parseCoordinates = (
    node: Element | string
  ): number[][] | null => {
    const coordinates_text = typeof node === "string" ? node : node.textContent;
    if (!coordinates_text) return null;

    const split = coordinates_text.trim().split(" ");

    const coordinates = [];
    for (const item of split) {
      const coord = this.parseCoordinate(item);
      if (coord) coordinates.push(coord);
    }

    return coordinates;
  };

  private readonly parseGeometry = (
    node: Element,
    styles: any[],
    style_maps: any[],
    folder_id: string | null
  ): Geometry | null => {
    const type_map: Record<
      string,
      "Point" | "LineString" | "Polygon" | "GeometryCollection"
    > = {
      Point: "Point",
      LineString: "LineString",
      Polygon: "Polygon",
      MultiGeometry: "GeometryCollection",
    };

    const geometry_type = type_map[node.nodeName];
    if (!geometry_type) return null;

    if (geometry_type === "GeometryCollection") {
      const geometry_nodes = this.get(node, "Point", true)
        .concat(this.get(node, "LineString", true))
        .concat(this.get(node, "Polygon", true));

      const geometries: Geometry[] = [];

      for (const geometry_node of geometry_nodes) {
        const geometry = this.parseGeometry(
          geometry_node,
          styles,
          style_maps,
          folder_id
        );
        if (!geometry) continue;
        geometries.push(geometry);
      }

      return {
        type: "GeometryCollection",
        geometries,
      };
    } else {
      const coordinates_node = this.get1(node, "coordinates");
      if (!coordinates_node) return null;

      const multiple_coords =
        geometry_type === "LineString" || geometry_type === "Polygon";

      const coordinates = multiple_coords
        ? this.parseCoordinates(coordinates_node)
        : this.parseCoordinate(coordinates_node);
      if (!coordinates) return null;

      return {
        type: geometry_type,
        coordinates,
      } as Point | LineString | Polygon;
    }
  };

  private readonly parseExtendedData = (node: Element, schemas: any[]) => {
    const schema_data_nodes = this.get(node, "SchemaData");
    const data_nodes = this.get(node, "Data");

    const extended_data_obj: Record<string, any> = {};

    for (const schema_data_node of schema_data_nodes) {
      const schema_url = schema_data_node.getAttribute("schemaUrl");
      if (!schema_url || !schema_url.startsWith("#")) continue;

      const schema_id = schema_url.substring(1);

      const schema = schemas.find((_) => _.id === schema_id);
      if (!schema) continue;

      const simple_data_nodes = this.get(schema_data_node, "SimpleData");

      for (const simple_data_node of simple_data_nodes) {
        const name = simple_data_node.getAttribute("name");
        const value = simple_data_node.textContent;
        if (!name || value === null) continue;

        const field_type = schema.fields[name];
        if (!field_type) continue;

        switch (field_type) {
          case "string":
            extended_data_obj[name] = value;
            break;

          case "int":
          case "uint":
          case "short":
          case "ushort":
            extended_data_obj[name] = parseInt(value);
            break;

          case "float":
          case "double":
            extended_data_obj[name] = parseFloat(value);
            break;

          case "bool":
            extended_data_obj[name] = value === "true";
            break;
        }
      }
    }

    for (const data_node of data_nodes) {
      const name = data_node.getAttribute("name");
      const value_node = this.get1(data_node, "value");
      const value = value_node?.textContent;
      if (!name || !value) continue;

      extended_data_obj[name] = value;
    }

    return extended_data_obj;
  };

  private readonly parsePlacemark = (
    node: Element,
    styles: any[],
    style_maps: any[],
    schemas: any[],
    folder_id: string | null,
    feature_uuid_map: (e: Element) => string
  ) => {
    const name_node = this.get1(node, "name");
    const description_node = this.get1(node, "description");
    const style_url_node = this.get1(node, "styleUrl");
    const style_id = style_url_node?.textContent;

    const point_node = this.get1(node, "Point", true);
    const linestring_node = this.get1(node, "LineString", true);
    const polygon_node = this.get1(node, "Polygon", true);
    const multi_geometry_node = this.get1(node, "MultiGeometry", true);

    const geometry_node =
      point_node || linestring_node || polygon_node || multi_geometry_node;
    if (!geometry_node) return null;

    const geometry_node_type = geometry_node.nodeName;

    const geometry = this.parseGeometry(
      geometry_node,
      styles,
      style_maps,
      folder_id
    );

    const extended_data_node = this.get1(node, "ExtendedData");
    const extended_data = extended_data_node
      ? this.parseExtendedData(extended_data_node, schemas)
      : null;

    const properties: any = {
      name: name_node?.textContent ?? "",
      description: description_node?.textContent ?? "",
      folder_id,
    };

    if (extended_data) {
      properties["extended_data"] = extended_data;
    }

    if (geometry_node_type !== "MultiGeometry" && style_id) {
      const style_map = style_maps.find(
        (_) => _.id === style_id.replace("#", "")
      );
      const style = styles.find(
        (_) => _.style_id === style_id.replace("#", "")
      );
      if (style_map) {
        const normal_style = styles.find(
          (_) => _.style_id === style_map.normal
        );
        const highlight_style = styles.find(
          (_) => _.style_id === style_map.highlight
        );

        if (normal_style) {
          Object.keys(normal_style).forEach((key) => {
            if (key === "style_id") return;
            const value = normal_style[key];
            properties[key] = value;
          });
        }
        if (highlight_style) {
          Object.keys(highlight_style).forEach((key) => {
            if (key === "style_id") return;
            const value = highlight_style[key];
            if (!(normal_style && normal_style[key] === highlight_style[key]))
              properties["highlight-" + key] = value;
          });
        }
      } else if (style) {
        Object.keys(style).forEach((key) => {
          if (key === "style_id") return;
          const value = style[key];
          properties[key] = value;
        });
      }

      Object.keys(properties).forEach((key) => {
        if (
          geometry_node_type !== "Point" &&
          (key.startsWith("icon-") || key.startsWith("highlight-icon-"))
        ) {
          delete properties[key];
        }
        if (
          geometry_node_type !== "LineString" &&
          (key.startsWith("line-") || key.startsWith("highlight-line-"))
        ) {
          delete properties[key];
        }
        if (
          geometry_node_type !== "Polygon" &&
          (key.startsWith("fill-") || key.startsWith("highlight-fill-"))
        ) {
          delete properties[key];
        }
      });
    }

    const id = feature_uuid_map(node);

    return {
      type: "Feature",
      id,
      geometry,
      properties,
    };
  };

  private readonly parseFolder = (
    node: Element,
    parent_folder_id: string | null
  ): KmlFolder => {
    const name_node = this.get1(node, "name");

    return {
      folder_id: crypto.randomUUID(),
      name: name_node?.textContent ?? "Untitled folder",
      parent_folder_id,
    };
  };

  private geometryIsValid(coordinates: number[] | number[][]) {
    for (const item of coordinates) {
      if (Array.isArray(item)) {
        for (const item2 of item) {
          if (isNaN(item2)) {
            console.log("[kml-to-geojson] Geometry is invalid: ");
            console.log(JSON.stringify(coordinates));
            return false;
          }
        }
      } else {
        if (isNaN(item)) {
          console.log("[kml-to-geojson] Geometry is invalid: ");
          console.log(JSON.stringify(coordinates));
          return false;
        }
      }
    }

    return true;
  }

  private readonly parseNode = (
    node: Element,
    folder_id: string | null = null,
    styles: any[],
    style_maps: any[],
    schemas: any[],
    folders: any[] = [],
    placemarks: any[] = [],
    level = 0,
    feature_uuid_map: (e: Element) => string
  ) => {
    const node_name = node.nodeName;

    // Parse current node
    if (node_name === "Placemark") {
      const placemark = this.parsePlacemark(
        node,
        styles,
        style_maps,
        schemas,
        folder_id,
        feature_uuid_map
      );
      if (placemark) {
        placemarks.push(placemark);
      }
    } else if (node_name === "Folder") {
      const folder = this.parseFolder(node, folder_id);
      folders.push(folder);
      folder_id = folder.folder_id;
    }

    // Loop through children
    if (node.childNodes) {
      for (let i = 0; i < node.childNodes.length; i++) {
        const child_node = node.childNodes[i];
        this.parseNode(
          child_node as Element,
          folder_id,
          styles,
          style_maps,
          schemas,
          folders,
          placemarks,
          level + 1,
          feature_uuid_map
        );
      }
    }
  };

  private readonly streamParseNode = async (
    node: Element,
    folder_id: string | null = null,
    styles: any[],
    style_maps: any[],
    schemas: any[],
    on_folder: (folder: KmlFolder) => any | void | Promise<any> | Promise<void>,
    on_geometry: (
      geometry: KmlFeature<any>
    ) => any | void | Promise<any> | Promise<void>,
    level = 0,
    feature_uuid_map: (e: Element) => string
  ) => {
    const node_name = node.nodeName;

    // Parse current node
    if (node_name === "Placemark") {
      const placemark = this.parsePlacemark(
        node,
        styles,
        style_maps,
        schemas,
        folder_id,
        feature_uuid_map
      );
      await on_geometry(placemark as KmlFeature<any>);
    } else if (node_name === "Folder") {
      const folder = this.parseFolder(node, folder_id);
      await on_folder(folder);
      folder_id = folder.folder_id;
    }

    // Loop through children
    if (node.childNodes) {
      for (let i = 0; i < node.childNodes.length; i++) {
        const child_node = node.childNodes[i];
        await this.streamParseNode(
          child_node as Element,
          folder_id,
          styles,
          style_maps,
          schemas,
          on_folder,
          on_geometry,
          level + 1,
          feature_uuid_map
        );
      }
    }
  };

  private readonly parseStyleNode = (node: Element) => {
    const icon_style_node = this.get1(node, "IconStyle");
    const line_style_node = this.get1(node, "LineStyle");
    const poly_style_node = this.get1(node, "PolyStyle");
    const label_style_node = this.get1(node, "LabelStyle");

    const id = node.getAttribute("id");

    const obj: any = {
      style_id: id,
    };

    if (icon_style_node) {
      const color_node = this.get1(icon_style_node, "color");
      if (color_node) {
        const { color, opacity } = this.kmlColor(color_node.textContent);
        obj["icon-color"] = color;
        obj["icon-opacity"] = opacity;
      }

      const scale_node = this.get1(icon_style_node, "scale");
      if (scale_node) {
        const scale_content = scale_node.textContent;
        if (scale_content && !isNaN(parseFloat(scale_content))) {
          obj["icon-size"] = parseFloat(scale_content);
        }
      }

      const icon_node = this.get1(icon_style_node, "Icon");
      if (icon_node) {
        const href_node = this.get1(icon_node, "href");
        if (href_node && href_node.textContent) {
          obj["icon-image"] = href_node.textContent;
        }
      }
    }

    if (line_style_node) {
      const color_node = this.get1(line_style_node, "color");
      if (color_node) {
        const { color, opacity } = this.kmlColor(color_node.textContent);
        obj["line-color"] = color;
        obj["line-opacity"] = opacity;
      }

      const width_node = this.get1(line_style_node, "width");
      if (width_node) {
        const width_content = width_node.textContent;
        if (width_content && !isNaN(parseFloat(width_content))) {
          obj["line-width"] = parseFloat(width_content);
        }
      }
    }

    if (poly_style_node) {
      const color_node = this.get1(poly_style_node, "color");
      if (color_node) {
        const { color, opacity } = this.kmlColor(color_node.textContent);
        obj["fill-color"] = color;
        obj["fill-opacity"] = opacity;
        obj["fill-outline-color"] = color;
      }
    }

    if (label_style_node) {
      const color_node = this.get1(label_style_node, "color");
      if (color_node) {
        const { color, opacity } = this.kmlColor(color_node.textContent);
        obj["text-color"] = color;
        obj["text-opacity"] = opacity;
      }

      const scale_node = this.get1(label_style_node, "scale");
      if (scale_node) {
        const scale_content = scale_node.textContent;
        if (scale_content && !isNaN(parseFloat(scale_content))) {
          obj["text-size"] = Math.round(parseFloat(scale_content) * 16);
        }
      }
    }

    return obj;
  };

  private readonly parseStyles = (node: Element) => {
    const style_nodes = node.getElementsByTagName("Style");
    const cascading_style_nodes =
      node.getElementsByTagName("gx:CascadingStyle");
    const style_map_nodes = node.getElementsByTagName("StyleMap");

    const styles = [];
    const style_maps = [];

    for (let i = 0; i < style_nodes.length; i++) {
      const style_node = style_nodes[i];
      if (style_node.hasAttribute("id")) {
        styles.push(this.parseStyleNode(style_node));
      }
    }

    for (let i = 0; i < cascading_style_nodes.length; i++) {
      const cascading_style_node = cascading_style_nodes[i];
      const id = cascading_style_node.getAttribute("kml:id") ?? "";

      const style_node = this.get1(cascading_style_node, "Style");
      if (style_node) {
        style_node.setAttribute("id", id);
        styles.push(this.parseStyleNode(style_node));
      }
    }

    for (let i = 0; i < style_map_nodes.length; i++) {
      const style_map_node = style_map_nodes[i];
      const style_map_id = style_map_node.getAttribute("id");
      const obj: any = { id: style_map_id };

      const pairs = style_map_node.getElementsByTagName("Pair");

      for (let j = 0; j < pairs.length; j++) {
        const pair = pairs[j];

        const key_node = this.get1(pair, "key");
        const style_url_node = this.get1(pair, "styleUrl");

        if (key_node && style_url_node) {
          const key = key_node.textContent ?? "";
          const style_url = (style_url_node.textContent ?? "").replace("#", "");
          obj[key] = style_url;
        }
      }

      style_maps.push(obj);
    }

    return { styles, style_maps };
  };

  private readonly parseSchemaNode = (node: Element) => {
    const id = node.getAttribute("id");

    const schema_obj: any = {
      id,
      fields: {},
    };

    const simple_fields = node.getElementsByTagName("SimpleField");

    for (let i = 0; i < simple_fields.length; i++) {
      const simple_field = simple_fields[i];
      const name = simple_field.getAttribute("name");
      const type = simple_field.getAttribute("type");
      if (name !== null && type !== null) {
        schema_obj.fields[name] = type;
      }
    }

    return schema_obj;
  };

  private readonly parseSchemas = (node: Element) => {
    const schema_nodes = node.getElementsByTagName("Schema");

    const schemas = [];

    for (let i = 0; i < schema_nodes.length; i++) {
      const schema_node = schema_nodes[i];
      if (schema_node.hasAttribute("id")) {
        schemas.push(this.parseSchemaNode(schema_node));
      }
    }

    return schemas;
  };

  public readonly parse = <T extends GeoJsonProperties = GeoJsonProperties>(
    kml_content: string,
    feature_uuid_map: (e: Element) => string = (_) => crypto.randomUUID()
  ): {
    folders: KmlFolder[];
    geojson: KmlGeojson;
  } => {
    const folders: any[] = [];
    const placemarks: any[] = [];

    const dom = new DOMParser().parseFromString(kml_content);
    const kml_node = this.get1(dom as any as Element, "kml")!;

    const { styles, style_maps } = this.parseStyles(kml_node);

    const schemas = this.parseSchemas(kml_node);

    this.parseNode(
      kml_node,
      null,
      styles,
      style_maps,
      schemas,
      folders,
      placemarks,
      0,
      feature_uuid_map
    );

    const geojson: KmlGeojson<T> = {
      type: "FeatureCollection",
      features: placemarks,
    };

    return { folders, geojson };
  };

  public readonly streamParse = async <
    T extends GeoJsonProperties = GeoJsonProperties
  >(
    kml_content: string,
    on_folder: (folder: KmlFolder) => any | void | Promise<any> | Promise<void>,
    on_geometry: (
      geometry: KmlFeature<T>
    ) => any | void | Promise<any> | Promise<void>,
    feature_uuid_map: (e: Element) => string = (_) => crypto.randomUUID()
  ) => {
    const dom = new DOMParser().parseFromString(kml_content);
    const kml_node = this.get1(dom as any as Element, "kml")!;

    const { styles, style_maps } = this.parseStyles(kml_node);

    const schemas = this.parseSchemas(kml_node);

    await this.streamParseNode(
      kml_node,
      null,
      styles,
      style_maps,
      schemas,
      on_folder,
      on_geometry,
      0,
      feature_uuid_map
    );
  };
}
